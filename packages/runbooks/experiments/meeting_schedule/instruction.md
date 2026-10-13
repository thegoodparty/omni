# Meeting Schedule

Given a state + position/office name, find the **regular recurring public meeting schedule** for that body and emit it as an iCalendar RRULE artifact. Output drives the gp-api meetings list endpoint, which projects future + past meetings deterministically from the RRULE. Both signals are required: the recurrence rule itself plus official-source citations proving it.

The position name (`office`) usually contains the jurisdiction (e.g. `"Burnsville City Council Member"` → Burnsville). When it doesn't (e.g. just `"City Council"`), the agent must infer the city via WebSearch over `office` + `state` before proceeding.

## BEFORE YOU START

1. Read this entire instruction end-to-end before executing anything.
2. Maintain a TodoWrite list mirroring the TODO CHECKLIST below.
3. Your params are in the JSON file named by the `PARAMS_FILE` env var. Read them once at the top.
4. Write the final artifact to `/workspace/output/meeting_schedule.json` and nowhere else.
5. Run `python3 /workspace/validate_output.py` (schema-only fast check) and then `python3 /workspace/qa_checks.py` (deterministic semantic checks, e.g. hint quality) before declaring success.
6. Perform the spot-check at the bottom — validator-passing data can still be garbage.

## TODO CHECKLIST

1. Read `PARAMS_FILE`. Capture `state`, `office`. Derive the jurisdiction (city / town / county) from `office`; if `office` is generic, WebSearch `office` + `state` to identify it before any other step. If `known_schedule_location` is present, hold it as the channel-0 hint for Step 2.
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
PARAMS = json.load(open(os.environ["PARAMS_FILE"]))
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
