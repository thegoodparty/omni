# Meeting Schedule

Given a state + position/office name, find the **regular recurring public meeting schedule** for that body and emit it as an iCalendar RRULE artifact. Output drives the gp-api meetings list endpoint, which projects future + past meetings deterministically from the RRULE. Both signals are required: the recurrence rule itself plus official-source citations proving it.

The position name (`office`) usually contains the jurisdiction (e.g. `"Burnsville City Council Member"` → Burnsville). When it doesn't (e.g. just `"City Council"`), the agent must infer the city via WebSearch over `office` + `state` before proceeding.

## BEFORE YOU START

1. Read this entire instruction end-to-end before executing anything.
2. Maintain a TodoWrite list mirroring the TODO CHECKLIST below.
3. Your params are in the `PARAMS_JSON` env var. Read them once at the top.
4. Write the final artifact to `/workspace/output/meeting_schedule.json` and nowhere else.
5. Run `python3 /workspace/validate_output.py` (schema-only fast check) and then `python3 /workspace/qa_checks.py` (deterministic semantic checks, e.g. hint quality) before declaring success.
6. Perform the spot-check at the bottom — validator-passing data can still be garbage.

## TODO CHECKLIST

1. Read `PARAMS_JSON`. Capture `state`, `office`. Derive the jurisdiction (city / town / county) from `office`; if `office` is generic, WebSearch `office` + `state` to identify it before any other step. If `known_schedule_location` is present, hold it as the channel-0 hint for Step 2.
2. Try the channel-0 hint first when present; otherwise discover the official government site via `WebSearch` (city/county domain, ideally `.gov` or `.us`).
3. Fetch the agendas / meetings / city council page via `pmf_runtime.http.get` and confirm a recurring schedule is stated.
4. If no recurring schedule appears on a top-level page, search for and fetch the municipal code section (often searchable as `<jurisdiction> <state> municipal code council meetings`).
5. Determine local meeting time, IANA timezone, and typical duration.
6. Capture the official `meeting_name` (e.g. "City Council") and customary `location` (e.g. "City Hall Council Chambers, 200 Main St") from the same official source.
7. Encode the recurrence as an iCalendar RFC 5545 RRULE string. Do **not** include `DTSTART`.
8. Collect every URL touched into `sources` with a one-sentence `note` per entry.
9. Set `discovered_schedule_location` to the best current prose for finding the schedule next time (prefer a URL to the parent page; see Step 8b).
10. Assemble the artifact and write to `/workspace/output/meeting_schedule.json`.
11. Run `python3 /workspace/validate_output.py` (schema) and `python3 /workspace/qa_checks.py` (semantic checks).
12. Perform the spot-check.

If after STEP 4 you cannot find an explicit recurring schedule from an official source, set `status: "not_found"` with empty string / `0` defaults for all schedule fields. **You SHOULD still populate `sources` with the URLs you searched** so a reviewer can audit the search trail — `sources` is optional but useful for `not_found`. **Do not invent a schedule.**

## CRITICAL RULES

**Web (`WebSearch` + `pmf_runtime.http.get`)**:

- **Use `WebSearch` for URL discovery.** The Claude SDK built-in `WebSearch` works (returns search results with URLs and snippets). Do NOT use `WebFetch` — the runner is in a quarantined network and `WebFetch` returns "Unable to verify if domain X is safe to fetch" because claude.ai's domain-safety check can't reach it.

- **Use `pmf_runtime.http.get(url)` for page retrieval** (broker-proxied). Verbatim:

  ```python
  from pmf_runtime import http
  r = http.get("https://example.gov/city-council/agendas")
  # r = {"status": 200, "headers": {...}, "body": "<html>…</html>"}
  print(r["body"][:2000])
  ```

  The response is a **plain dict** — `r["status"]` (int), `r["headers"]` (dict), `r["body"]` (str). It is NOT a `requests.Response`. Calling `r.status_code` or `r.text` raises `AttributeError`.

- The broker enforces an SSRF guard and URL allowlist on `http.get`. Private IPs and internal hostnames are blocked.

**RRULE**:

- The `rrule` field MUST be a valid iCalendar RFC 5545 string and MUST NOT contain a `DTSTART` line. The downstream consumer anchors it.
- Day codes: `MO TU WE TH FR SA SU`. Ordinal prefixes (`1MO`, `2MO`, `-1MO` for "last Monday") combine with `FREQ=MONTHLY`.
- Reference patterns:

  | Plain English                     | RRULE                             |
  | --------------------------------- | --------------------------------- |
  | Every Monday                      | `FREQ=WEEKLY;BYDAY=MO`            |
  | 2nd and 4th Monday of every month | `FREQ=MONTHLY;BYDAY=2MO,4MO`      |
  | 1st Wednesday of every month      | `FREQ=MONTHLY;BYDAY=1WE`          |
  | Every other Tuesday               | `FREQ=WEEKLY;INTERVAL=2;BYDAY=TU` |
  | 15th of every month               | `FREQ=MONTHLY;BYMONTHDAY=15`      |
  | First and third Thursday          | `FREQ=MONTHLY;BYDAY=1TH,3TH`      |
  | Every Tuesday and Thursday        | `FREQ=WEEKLY;BYDAY=TU,TH`         |

**Time + timezone**:

- `time` is 24-hour `HH:MM` in the meeting's local time. `19:00`, not `7:00 PM`. No seconds, no offset.
- `timezone` is an IANA name (`America/Denver`, `America/Chicago`, `America/New_York`, `America/Los_Angeles`, `America/Phoenix`, `America/Anchorage`, `Pacific/Honolulu`). Never an abbreviation (`MST`, `CST`) and never a UTC offset (`-07:00`).
- Arizona doesn't observe DST → `America/Phoenix`. Other tz-database edge cases: look up the city in https://en.wikipedia.org/wiki/List_of_tz_database_time_zones if the obvious answer might be wrong.

**Sources**:

- Every URL touched during research goes in `sources` with a one-sentence `note` describing what it confirmed.
- For `status: "found"`: at least one entry, and at least one source MUST be an official government domain (city/county site, municipal code, agenda portal). News and aggregator sites alone do not qualify.
- For `status: "not_found"`: `sources` MAY be empty, but populating it with the URLs you searched is preferred — it lets a reviewer audit the search trail and tell "tried hard, came up empty" apart from "bailed early."

**Output (always include)**:

- Write **only** to `/workspace/output/meeting_schedule.json`. The runner publishes nothing else.
- Run `python3 /workspace/validate_output.py` (schema-only) and `python3 /workspace/qa_checks.py` (semantic — flags placeholder/deep-link `discovered_schedule_location`) before declaring success. The runner-level validator will reject the artifact post-hoc if you skip the schema check; qa_checks.py adds the hint-quality checks the schema can't express. In-loop validation lets you fix violations cheaply.
- Every field in the schema MUST appear in the output, even when `status: "not_found"`. Use empty-string / `0` / `[]` defaults. Never use `null` — **with one exception**: `discovered_schedule_location` is typed `["string", "null"]` in the schema and Step 8b explicitly instructs you to set it to `null` on `not_found` when no plausible future-run starting point exists. Do NOT use an empty string `""` to fake a "missing" value for this field — that passes schema validation but seeds the next run with a useless hint and trips `qa_checks.py`. The empty-string / `0` / `[]` rule applies to every OTHER field in the schema.

## Steps

### Step 1 — Read params

```python
import json, os
PARAMS = json.loads(os.environ["PARAMS_JSON"])
STATE = PARAMS["state"]
OFFICE = PARAMS["office"]
KNOWN_LOCATION = PARAMS.get("known_schedule_location")  # optional hint from a prior run
print(f"Researching: {OFFICE} in {STATE}")
if KNOWN_LOCATION:
    print(f"Channel-0 hint available: {KNOWN_LOCATION[:200]}")
```

**Derive the jurisdiction.** `city` is no longer in PARAMS. Identify the city (or town / county / borough — whatever municipal unit the body belongs to) from `OFFICE`:

- If `OFFICE` literally names the jurisdiction (`"Burnsville City Council Member"`, `"Mayor of Cheyenne"`, `"Hennepin County Board"`) → parse it out.
- If `OFFICE` is generic (`"City Council"`, `"Council Member"`) → run a `WebSearch` for `f"{OFFICE} {STATE}"` and inspect the top official-domain hits to identify the jurisdiction. Ambiguity (e.g. multiple cities with a "Park District") → pick the most populous candidate as a starting point and confirm against the agendas page in Step 3.

Bind the derived jurisdiction to `CITY` for use in subsequent steps. All later `WebSearch` and `http.get` calls use this derived value — do **not** treat `CITY` as input.

### Step 2 — Find the official site

**Channel 0 (when `known_schedule_location` is present).** Try the hint first. It may be a URL or prose describing how to reach the schedule page. Fetch the URL with `pmf_runtime.http.get`; if prose, parse out a URL and fetch that. If the page still states the recurring schedule, you are done with discovery — proceed to Step 5. If the hint 404s, redirects to a generic landing page, or no longer states a recurrence, **do not bail** — record a `run_decision`-style note ("known_schedule_location stale: <reason>") and fall through to channel 1. The hint is a starting point, not an authority.

**Channel 1 (default discovery).**

```python
# Use the WebSearch tool, not http.get for this step
query = f"{CITY} {STATE} {OFFICE} official website agendas"
# Take the top hit on a *.gov or city domain; ignore Wikipedia, Yelp,
# news aggregators, calendar listing sites.
```

Walk the search hits looking for:

- City government domain (often `.gov`, `.us`, or `cityof<name>.com`)
- An "Agendas & Minutes" / "Meetings" / "City Council" page on that domain
- A municipal code section that codifies the meeting schedule

### Step 3 — Confirm a recurring schedule

```python
from pmf_runtime import http
r = http.get("https://<city-domain>/<agendas-page>")
assert r["status"] == 200, f"unexpected status {r['status']}"
body = r["body"]
# Look for explicit recurrence phrasing:
#   "City Council meets on the second and fourth Monday of each month at 7:00 PM."
#   "Regular meetings are held the first Tuesday of every month, 6:30 PM."
```

Examples that DO qualify as a stated recurrence:

- "City Council meets on the second and fourth Monday of each month at 7:00 PM."
- "Regular meetings are held the first Tuesday of every month, 6:30 PM, in Council Chambers."
- "The Council meets twice monthly. See [municipal code §2.04.010]."

Examples that do NOT qualify (do not use these alone):

- A calendar showing the next few meeting dates without a stated recurrence rule.
- A news article mentioning that "Council met last night."
- A scheduling page that lists ad-hoc workshops or special sessions.

### Step 4 — Municipal code fallback

If the agendas page doesn't state the recurrence explicitly, search for the municipal code:

```python
# WebSearch: f"{CITY} {STATE} municipal code council meetings"
# Then http.get the most credible *.gov result
r = http.get("https://library.municode.com/<state>/<city>/codes/...")
```

The municipal code is authoritative when present.

If after a thorough search no recurring schedule is found on any official source, go to STEP 8 and emit `status: "not_found"`.

### Step 5 — Time, timezone, duration

- **Time** — 24-hour `HH:MM`. Convert "7:00 PM" → `19:00`, "6:30 PM" → `18:30`, "9 AM" → `09:00`.
- **Timezone** — resolve from the city's geographic location. Eastern → `America/New_York`, Central → `America/Chicago`, Mountain (most) → `America/Denver`, Arizona → `America/Phoenix`, Pacific → `America/Los_Angeles`, Alaska → `America/Anchorage`, Hawaii → `Pacific/Honolulu`.
- **Duration** — search the agenda/minutes portal for typical adjournment patterns. If meetings start at 7:00 PM and minutes consistently show adjournment around 9:30 PM, `duration_minutes` is `150`. If you can't determine this in ~3 minutes of effort, use the default `120`.

### Step 6 — Meeting name + location

- **`meeting_name`** — the official name of the body as the source refers to it. Take this verbatim from the page heading or municipal code wording. Examples: `"City Council"`, `"Planning Board"`, `"Town Council"`. Do not infer or stylize; if the input `office` is `"City Council"` but the page consistently says `"Common Council"`, write `"Common Council"`.
- **`location`** — the customary regular-meeting location. Prefer the room + street address as stated in the agenda or municipal code, e.g. `"City Hall Council Chambers, 200 Main St"`. If the source only states a room (`"Council Chambers"`), prepend the city hall name. If the source only states an address, use that. If no location is stated anywhere on the official site, fall back to the city hall's published address — never leave this blank when `status: "found"`.

### Step 7 — Encode RRULE

Translate the recurrence into RFC 5545 RRULE notation (see CRITICAL RULES table). Do not include `DTSTART`. Do not include a count or end date — the schedule is open-ended.

Verify your RRULE makes semantic sense by writing it back out in English in the `human` field. If you can't paraphrase the RRULE in English matching the source's wording, the RRULE is wrong.

### Step 8 — Collect sources

Every URL touched in Steps 2-7 goes into `sources` with a one-sentence `note`. At least one source must be on an official government domain when `status: "found"`.

### Step 8b — Set `discovered_schedule_location`

gp-api persists this string and passes it back as `known_schedule_location` on the next run for the same office. Optimize it for a future agent reading it cold.

- **Prefer a URL to the parent page over a deep link.** The municipal-code section that codifies the recurrence is the best target when present (e.g. `https://library.municode.com/<state>/<city>/codes/code_of_ordinances?nodeId=...`). Next best is the city's recurring "meetings" or "agendas" landing page that states the schedule inline. Avoid recording one-off agenda PDFs or calendar event URLs — those are per-meeting, not per-schedule.
- **Prose is allowed when no single URL captures it.** Multi-step paths ("Top nav → Government → City Council → §2.04.010") are useful when the schedule is buried under accordions or behind an interstitial. Lead with a URL and append the navigation prose when both add value.
- **When the hint worked.** If you arrived at the schedule via the channel-0 hint and it is still accurate, write the hint back unchanged (this confirms it for the next run).
- **When the hint was stale.** Replace it with whatever location you found instead. Do not chain "hint X is stale, try Y" into the prose — record the current best location only.
- **For `status: "not_found"`.** Set to a URL of the most likely future location (the city's meetings page, even if it currently lacks a stated recurrence) so the next run starts there. Set to `null` only when no plausible lead exists.

### Step 9 — Write the artifact

```python
import json, pathlib
from datetime import datetime, timezone

artifact = {
    "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z"),
    "status": "found",
    "meeting_name": "City Council",
    "location": "City Hall Council Chambers, 200 Main St",
    "rrule": "FREQ=MONTHLY;BYDAY=2MO,4MO",
    "human": "Second and fourth Monday of every month",
    "time": "19:00",
    "timezone": "America/Denver",
    "duration_minutes": 180,
    "sources": [
        {
            "url": "https://example.gov/city-council/agendas",
            "note": "Official agendas page states 2nd and 4th Monday at 7 PM in Council Chambers"
        }
    ],
    "discovered_schedule_location": "https://example.gov/city-council/agendas",
}
pathlib.Path("/workspace/output").mkdir(parents=True, exist_ok=True)
pathlib.Path("/workspace/output/meeting_schedule.json").write_text(
    json.dumps(artifact, indent=2)
)
```

**`not_found` shape** (schedule fields empty; `sources` optionally populated with the search trail):

```python
artifact = {
    "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z"),
    "status": "not_found",
    "meeting_name": "",
    "location": "",
    "rrule": "",
    "human": "",
    "time": "",
    "timezone": "",
    "duration_minutes": 0,
    "sources": [
        {
            "url": "https://example.gov/city-council/",
            "note": "Official council page lists individual meeting dates but no stated recurrence rule"
        },
        {
            "url": "https://library.municode.com/...",
            "note": "Municipal code searched — no section codifying meeting schedule"
        }
    ],  # populating sources is preferred but optional for not_found
    "discovered_schedule_location": "https://example.gov/city-council/",
}
```

### Step 10 — Validate

```bash
python3 /workspace/validate_output.py
python3 /workspace/qa_checks.py
```

If schema validation fails, read the error, fix the artifact, re-run. If `qa_checks.py` reports warnings (e.g. `discovered_schedule_location.placeholder` or `.deep_link`), fix the hint to be a real parent-page URL or set it to `null`. Do NOT declare success until both run cleanly.

## Spot-check

Validator-passing JSON can still be garbage. Before declaring success, manually verify:

- **`status: "found"` requires an official source.** If `sources` contains only news outlets, blogs, or aggregator sites, downgrade to `status: "not_found"` and clear the schedule fields. Re-run validation.
- **The `human` field matches the `rrule` literally.** Read your `human` description aloud; mechanically construct the RRULE from it and confirm it equals the value you wrote. Common bug: source says "second Monday" but agent writes `FREQ=WEEKLY;BYDAY=MO` (every Monday) instead of `FREQ=MONTHLY;BYDAY=2MO`.
- **`timezone` is an IANA name, not an abbreviation.** `America/Denver` not `MST`. `America/Phoenix` not `America/Denver` for Arizona cities.
- **`time` is 24-hour with leading zero on the hour.** `19:00` not `7:00 PM`. `09:00` not `9:00`.
- **`duration_minutes > 0` when `status: "found"`.** Default to `120` if unknown; never leave at `0`.
- **`meeting_name` and `location` non-empty when `status: "found"`.** Both fail validation if blank. Use the verbatim body name and the room+address (or city hall address) — never a placeholder like `"TBD"`.
- **`discovered_schedule_location` points at the parent page, not a deep link.** If it's a URL to one specific agenda PDF or one calendar event, swap it for the page that LISTS the schedule (the meetings index or the municipal-code section). If you can't find a parent page, prose is fine. `null` only when there is no plausible future-run starting point.

## Failure modes

| Symptom                                                            | Cause                                                         | Fix                                                                                    |
| ------------------------------------------------------------------ | ------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `WebFetch` returns "Unable to verify if domain X is safe to fetch" | Used `WebFetch` instead of `pmf_runtime.http.get`             | Use `pmf_runtime.http.get(url)` for page bodies; `WebSearch` only for URL discovery    |
| `r.status_code` raises `AttributeError`                            | Treated `http.get` response as `requests.Response`            | Response is a dict — use `r["status"]`, `r["headers"]`, `r["body"]`                    |
| oneOf validation failure on `found` branch                         | RRULE is empty or doesn't start with `FREQ=`                  | If you have a real recurrence, fix the RRULE; if not, switch `status` to `"not_found"` |
| oneOf validation failure on `not_found` branch                     | Left non-empty schedule fields when status is `not_found`     | Set `rrule`, `human`, `time`, `timezone` to `""` and `duration_minutes` to `0`         |
| `time` pattern violation                                           | Used `7:00 PM` or `7:00` (no leading zero)                    | Convert to 24-hour `HH:MM`: `19:00`, `09:00`                                           |
| `timezone` pattern violation                                       | Used an abbreviation like `MST` or a UTC offset like `-07:00` | Use IANA name: `America/Denver`                                                        |
| `sources` minItems violation when `status: "found"`                | Forgot to record source URLs                                  | Add every URL you touched with a one-sentence `note`                                   |
| Found a calendar listing but no recurrence statement               | Confused upcoming-meetings calendar with recurrence rule      | A calendar of dates is not a rule — go to municipal code or downgrade to `not_found`   |
