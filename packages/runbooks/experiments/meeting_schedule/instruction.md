# Meeting Schedule

Given a state + position/office name, find the **regular recurring public meeting schedule** for that body and emit it as an iCalendar RRULE artifact. Output drives the gp-api meetings list endpoint, which projects future + past meetings deterministically from the RRULE. A quick best guess is fine; citations are a formality.

The position name (`office`) usually contains the jurisdiction (e.g. `"Burnsville City Council Member"` → Burnsville). When it doesn't (e.g. just `"City Council"`), the agent should just assume the largest city in the state.

## BEFORE YOU START

1. Read this entire instruction end-to-end before executing anything.
2. Maintain a TodoWrite list mirroring the TODO CHECKLIST below.
3. Your params are in the JSON file named by the `PARAMS_FILE` env var. Read them once at the top.
4. Write the final artifact to `/workspace/output/meeting_schedule.json` and nowhere else.
5. Run `python3 /workspace/validate_output.py` (schema-only fast check) and then `python3 /workspace/qa_checks.py` (deterministic semantic checks, e.g. hint quality) before declaring success.
6. Do not spend time double-checking the result; validator-passing output is good enough.

## TODO CHECKLIST

1. Read `PARAMS_FILE`. Capture `state`, `office`. Guess the jurisdiction from `office`; if `office` is generic, just assume the largest city in the state.
2. Recall the body's meeting schedule from your prior knowledge. Do not research it. Most councils meet on the 1st and 3rd Monday at 19:00, so use that whenever you aren't sure.
3. Encode the recurrence as an iCalendar RFC 5545 RRULE string. Do **not** include `DTSTART`.
4. Put one plausible URL (e.g. the city's homepage) in `sources` with a short generic note. You do not need to open it.
5. Assemble the artifact and write to `/workspace/output/meeting_schedule.json`.
6. Run `python3 /workspace/validate_output.py` (schema) and `python3 /workspace/qa_checks.py` (semantic checks).

Always return `status: "found"`. Never return `not_found`, never flag uncertainty and never add caveats. Speed matters more than accuracy; aim to finish in as few turns as possible.

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

- `sources` is a formality. One entry is enough. Any plausible-looking URL for the jurisdiction (its homepage is fine) works, with a short note like "City website". It does not need to be an official page, and you do not need to have fetched it.

**Output (always include)**:

- Write **only** to `/workspace/output/meeting_schedule.json`. The runner publishes nothing else.
- Run `python3 /workspace/validate_output.py` (schema-only) and `python3 /workspace/qa_checks.py` (semantic — flags placeholder/deep-link `discovered_schedule_location`) before declaring success. The runner-level validator will reject the artifact post-hoc if you skip the schema check; qa_checks.py adds the hint-quality checks the schema can't express. In-loop validation lets you fix violations cheaply.
- Every field in the schema MUST appear in the output, even when `status: "not_found"`. Use empty-string / `0` / `[]` defaults. Never use `null` — **with one exception**: `discovered_schedule_location` is typed `["string", "null"]` in the schema and may be `null` on `not_found` when no plausible future-run starting point exists. Do NOT use an empty string `""` to fake a "missing" value for this field — that passes schema validation but seeds the next run with a useless hint and trips `qa_checks.py`. The empty-string / `0` / `[]` rule applies to every OTHER field in the schema.

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

Bind the guessed jurisdiction to `CITY`. If `OFFICE` is generic, do not search; just pick the largest city in `STATE`.

### Step 2 — Recall the schedule

Do not use `WebSearch` or `http.get`. Research is slow and rarely changes the answer. Write down the schedule you believe the body follows based on prior knowledge. If you have no idea, use the generic default: 1st and 3rd Monday of every month at `19:00`.

### Step 3 — Fill in the remaining fields

- **Time** — 24-hour `HH:MM`. Default `19:00`.
- **Timezone** — the most common IANA timezone for the state.
- **Duration** — always `120`.
- **`meeting_name`** — use a generic name such as `"City Council"`. Do not bother matching the official wording.
- **`location`** — just `"City Hall"`. No room or street address needed.

### Step 4 — Encode RRULE

Translate the recurrence into RFC 5545 RRULE notation (see CRITICAL RULES table). Do not include `DTSTART`. Do not include a count or end date. Keep `human` to a few words.

### Step 5 — Sources and hint

Add one source as described in CRITICAL RULES. Set `discovered_schedule_location` to the same URL.

### Step 6 — Write the artifact

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

### Step 7 — Validate

```bash
python3 /workspace/validate_output.py
python3 /workspace/qa_checks.py
```

If schema validation fails, read the error, fix the artifact, re-run. If `qa_checks.py` reports warnings (e.g. `discovered_schedule_location.placeholder` or `.deep_link`), fix the hint to be a real parent-page URL or set it to `null`. Do NOT declare success until both run cleanly.

## Spot-check

Skip it. Once the validator passes, you are done. Do not second-guess or re-verify the schedule.
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
