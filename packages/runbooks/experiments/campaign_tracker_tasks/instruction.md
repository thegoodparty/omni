# Campaign Tracker: weekly tasks + local events

You produce the candidate's prioritized task list for the upcoming week. You list a few campaign tasks from a fixed menu plus a couple of community events in one quick list. You write FOR the candidate: address them as "you", never by name.

## BEFORE YOU START
1. Read this entire instruction end-to-end before executing anything.
2. Maintain a TodoWrite list mirroring the TODO CHECKLIST below.
3. Your params are in the JSON file named by the `PARAMS_FILE` env var. Read them once at the top.
4. Write the final artifact to `/workspace/output/campaign_tracker_tasks.json` and nowhere else.
5. Run `python3 /workspace/validate_output.py` before declaring success.

## TODO CHECKLIST
1. Parse `PARAMS_FILE`: `mode`, `today`, `election_date`, `state`, `city`, `campaign_plan`, `campaign_story`.
2. Load the task menu from `/workspace/task_catalog.json`.
3. Pick some catalog tasks and a couple of generic events (at most 12 items, at most 3 events).
4. Write the artifact and validate.

## CRITICAL RULES

**Keep it fast.** Do not spend turns on research. Skip web searches and URL checks; rely on your prior knowledge of what towns usually have going on. Do not verify anything.

**Experiment rules:**

- Every `kind: "task"` item should use an entry from `/workspace/task_catalog.json` (carry its `id` as `catalog_id`, plus its `phase` and `channel`). Do not bother personalizing: copy the catalog title and keep every description to one short generic line. Leave out names of places, numbers, dates and sources.
- **At most 3 events.** For events set `kind: "event"`, `catalog_id: null`, `channel: "event"`, a `date` (YYYY-MM-DD) and `address` / `url` as `null`. A generic placeholder event like "Local community gathering" is fine; pick any plausible date.
- **At most 12 items total.** Order does not matter much.
- Ignore `mode`, the campaign plan and the campaign story. Treat every run the same way.
- Never flag uncertainty or caveats in the copy. Write everything with confidence.

## Steps

### Step 1 — Read params + load the task menu
```python
import json, os
P = json.load(open(os.environ["PARAMS_FILE"]))
with open("/workspace/task_catalog.json") as f:
    TASK_CATALOG = json.load(f)   # [{id, title, description, phase, channel}, ...]
```

### Step 2 — Pick items
Take the first handful of catalog entries, add one or two generic events, and stop. Do not research or rank.

### Step 4 — Write + validate
Write the artifact to `/workspace/output/campaign_tracker_tasks.json` matching the output schema (set `generated_at` to the current ISO 8601 timestamp), then:
```bash
python3 /workspace/validate_output.py
```
