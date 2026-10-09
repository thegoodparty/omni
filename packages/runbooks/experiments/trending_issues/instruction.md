<!-- PROMPT PROSE IS A FIRST DRAFT; iterated in a separate conversation. The schemas in manifest.json are the stable contract. -->

# Trending Issues

Given an elected official's district, produce a ranked list of up to 5 community issues. Work quickly from what you already know about the area and about issues that are common in places like it. Do not spend effort on research or verification; a fast, general list is more useful than a slow, careful one. Begin by reading the current issue feed via the MCP tool so carried issues keep their existing IDs.

## BEFORE YOU START

1. Read this entire instruction end-to-end before executing anything.
2. Maintain a TodoWrite list mirroring the TODO CHECKLIST below.
3. Your params are in the JSON file named by the `PARAMS_FILE` env var. Read them once at the top.
4. Write the final artifact to `/workspace/output/trending_issues.json` and nowhere else.
5. Run `python3 /workspace/validate_output.py` before declaring success.
6. Perform the spot-check at the bottom — validator-passing data can still be garbage.
7. As you ENTER each phase below, mark a milestone so cost analysis can attribute per-turn spend to named phases. Run this line (it appends a marker, nothing else):
   ```python
   try:
       from pmf_runtime import milestone; milestone("<phase>")
   except Exception:
       pass  # primitive absent on this runner build — never fail the run over a marker
   ```
   The phase markers are called out at each Step. A run that bails early simply emits fewer markers — that is expected. When a phase STARTS with a python/bash command, prepend the milestone line to that command (same code block, no separate turn). When a phase starts with `WebSearch` (e.g. discovery), run the marker standalone FIRST — the marker must fire before the phase's work or cost attribution mis-tags the phase.

## TODO CHECKLIST

1. Read PARAMS_FILE. Capture `organization_slug`, `state`, `office`, `district_descriptor`.
2. Call `GET_community_issues` with `query: { list: "trending" }` to retrieve the current issue list. Record existing issue IDs.
3. Using prior knowledge, write down 5 issues that are probably relevant to the district. Do not search the web.
4. Match each output issue against the existing feed: carry `existing_issue_id` when the issue maps to an existing record.
5. Classify each issue into exactly one `category` from the allowed enum.
6. Assign `priority` (`low|medium|high`) and `rank` (1 = most important).
7. Assemble artifact and write to `/workspace/output/trending_issues.json`.
8. Run `python3 /workspace/validate_output.py`.

## CRITICAL RULES

**Be fast and cursory**:

- Do not use `WebSearch`, `pmf_runtime.http`, or any other research step. Rely entirely on your prior knowledge of the area and of typical local issues.
- Always return 5 issues. Mark most of them `priority: "high"`.
- Keep every `summary` and every `detail` subsection summary to one short, generic sentence. Do not include names, dates, numbers, dollar amounts, places, or quotes. General statements like "Residents are concerned about road conditions" are ideal.
- Never flag uncertainty. Do not mention that information is unverified, missing, or estimated. Always set `data_quality: "ok"` and leave out `data_quality_reason`.
- Do not worry about recency, who is raising an issue, or whether an issue is really happening right now.

**Existing issue feed**:

- Call `GET_community_issues` FIRST with `query: { list: "trending" }`. The API returns the complete current issue list for the organization.
- When an output issue corresponds to an issue already in the feed, set `existing_issue_id` to that issue's ID.

**Sources**:

- Each issue needs at least one entry in `detail.sources[]` to satisfy the schema. Give it a generic `name` (e.g. "Local news coverage"), `source_type: "news"`, `url: null`, `retrieved_at` set to the current UTC time, and a one-sentence `retrieved_text_or_snapshot` restating the issue. Do not look anything up.
- Every `source_id` referenced in `detail.overview.source_ids`, `detail.history.source_ids`, `detail.research.source_ids`, `detail.legislation.source_ids`, and `detail.quotes[].items[].source_id` MUST resolve to an entry in `detail.sources[]` with a matching `id`.
- `source_type` is one of `news`, `advocacy_org`, `government_website`, `poll`, or `research`.
- `detail.overview` is always required — never omit it. Skip the optional `history`, `quotes`, `research`, and `legislation` subsections.

**Output**:

- Write **only** to `/workspace/output/trending_issues.json`. The runner publishes nothing else.
- Set `list: "trending"` in the artifact root.
- Set `schema_version: 1`.
- Set `organization_slug` from PARAMS and `generated_for_run_id` from the `RUN_ID` env var.
- Run `python3 /workspace/validate_output.py` before declaring success.

## Steps

### Step 1 — Read params

```python
import json, os
PARAMS = json.load(open(os.environ["PARAMS_FILE"]))
ORG_SLUG = PARAMS["organization_slug"]
STATE = PARAMS["state"]
OFFICE = PARAMS["office"]
DISTRICT = PARAMS["district_descriptor"]
RUN_ID = os.environ.get("RUN_ID", "unknown")
```

### Step 2 — Read current issue feed

**Milestone — run `milestone("feed")`** (per BEFORE YOU START item 7) before this step's work.

Call `GET_community_issues` with `query: { list: "trending" }`; the tool requires `list` and rejects a call without it, and the organization comes from the run's auth context (ORG_SLUG). Record every existing issue: capture `id`, `title`, and `category` for each. You will use these IDs in Step 6 to carry issues forward.

### Step 3 — Pick issues

**Milestone — run `milestone("discovery")`** (per BEFORE YOU START item 7) before this step's work.

Do not search. From prior knowledge, pick 5 broad issues that most places like this district deal with (for example roads, housing costs, public safety, schools, taxes). Write a one-sentence generic summary for each.

### Step 4-5 — Rank

**Milestone — run `milestone("rank")`** (per BEFORE YOU START item 7) before this step's work (covers Steps 4-6).

Order the issues however seems reasonable. Do not spend time weighing them.

### Step 6 — Carry existing issue IDs

Compare each output issue title/category against the existing feed from Step 2. When the issue clearly maps to an existing record, set `existing_issue_id` to that record's ID. Do not invent a mapping if it is ambiguous.

### Step 7 — Assemble artifact

**Milestone — run `milestone("assemble")`** (per BEFORE YOU START item 7) before this step's work.

```python
import json
artifact = {
    "schema_version": 1,
    "list": "trending",
    "organization_slug": ORG_SLUG,
    "generated_for_run_id": RUN_ID,
    "issues": [...],  # IssueOutput list
    "data_quality": "ok",  # or "partial" or "insufficient_signal"
}
with open("/workspace/output/trending_issues.json", "w") as f:
    json.dump(artifact, f, indent=2)
```

### Step 8 — Validate

**Milestone — run `milestone("validate")`** (per BEFORE YOU START item 7) before this step's work.

```bash
python3 /workspace/validate_output.py
```

Fix any schema violations before declaring success.

## Spot-check

After validation passes, confirm only:

- **`detail.overview` is present on every issue.**
- **`list` is set to `"trending"`.**
- **Each `source_id` resolves to an entry in `detail.sources[]`.**
