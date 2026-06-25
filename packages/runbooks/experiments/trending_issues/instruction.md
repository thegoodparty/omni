<!-- PROMPT PROSE IS A FIRST DRAFT; iterated in a separate conversation. The schemas in manifest.json are the stable contract. -->

# Trending Issues

Given an elected official's district, produce a ranked list of up to 10 community issues that are actively trending in local news and public discourse right now. Draws from recent local news, direct resident voice (letters/op-eds), and the public output of local community advocacy groups, via web search — no Databricks/Haystaq data. The signal here is recency and volume: what is the community talking about this week, not what residents privately scored highest. Begin by reading the current issue feed via the MCP tool so carried issues keep their existing IDs.

## BEFORE YOU START

1. Read this entire instruction end-to-end before executing anything.
2. Maintain a TodoWrite list mirroring the TODO CHECKLIST below.
3. Your params are in the `PARAMS_JSON` env var. Read them once at the top.
4. Write the final artifact to `/workspace/output/trending_issues.json` and nowhere else.
5. Run `python3 /workspace/validate_output.py` before declaring success.
6. Perform the spot-check at the bottom — validator-passing data can still be garbage.

## TODO CHECKLIST

1. Read PARAMS_JSON. Capture `organization_slug`, `state`, `office`, `district_descriptor`.
2. Call `GET_community_issues` with `organization_slug` to retrieve the current issue list. Record existing issue IDs.
3. Run broad `WebSearch` queries for `<district_descriptor> local issues 2026` and related terms, including the public output of local community advocacy groups (associations, BIAs, neighborhood councils, coalitions; prefer nonpartisan), to identify candidate trending topics.
4. For each candidate topic: verify the top URL with `pmf_runtime.http.head`; escalate to `http.get` only if head returns 403/405 or you need body content.
5. Select up to 10 issues with the strongest recent signal (recency + coverage breadth).
6. Match each output issue against the existing feed: carry `existing_issue_id` when the issue maps to an existing record.
7. Classify each issue into exactly one `category` from the allowed enum.
8. Assign `priority` (`low|medium|high`) and `rank` (1 = most prominent/recent).
9. Deduplicate `detail.sources[]` by URL. Verify every `source_id` referenced in `source_ids` or `source_id` fields resolves to a source entry.
10. If fewer than 3 issues have strong signal, set `data_quality: "insufficient_signal"` and emit a near-empty list.
11. Assemble artifact and write to `/workspace/output/trending_issues.json`.
12. Run `python3 /workspace/validate_output.py`.
13. Perform the spot-check.

## CRITICAL RULES

**Existing issue feed**:

- Call `GET_community_issues` FIRST, before any research. The API returns the complete current issue list for the organization.
- When an output issue corresponds to an issue already in the feed, set `existing_issue_id` to that issue's ID. Never drop a prioritized existing issue unless it is clearly resolved.
- Prefer carrying an existing ID over creating a net-new issue for the same underlying concern.

**Thin-signal handling**:

- If fewer than 3 issues have verifiable recent coverage (within the last 90 days), set `data_quality: "insufficient_signal"`, populate `data_quality_reason` with a brief explanation, and emit an `issues` array with whatever confirmed issues exist (may be empty). Do NOT fabricate issues to pad the list.
- For smaller towns (under ~10k population), expect thin signal — don't escalate aggressively to compensate.

**Web (`WebSearch` + `pmf_runtime.http`)**:

- **Use `WebSearch` for URL discovery.** Do NOT use `WebFetch` — the quarantined network can't reach claude.ai's domain-safety check, so it always fails.
- **Web-access escalation ladder — use the cheapest rung that answers the question:**
  1. `WebSearch` (free, fast) — snippets often answer the question outright.
  2. `pmf_runtime.http.head(url)` — verify a URL is live. Returns `{"status": int, "final_url": str}`.
  3. `pmf_runtime.http.get(url)` — browser render (Chromium), LAST RESORT. Returns `{"status", "headers", "body", "source_url"}` (plain dict — `r["status"]`/`r["body"]`, never `.status_code`/`.text`). Use ONLY when head returned 403/405 or you must read the body.

  ```python
  from pmf_runtime import http
  r = http.head("https://example.com/article")
  if r["status"] in (403, 405):
      r = http.get("https://example.com/article")
  ```

- **Re-rendering every URL with `http.get` is the classic perf trap** — it makes runs time out. Verify with `head`; render only when forced.
- **Verify-once / fast-bail**: if a candidate issue can't be confirmed in 1-2 searches, mark it `insufficient_signal` for that issue and move on. Do not spend multiple turns escalating to the browser.
- The container is network-quarantined — `urllib`/`requests`/`httpx`/`curl`/`wget`/`socket` cannot reach the internet.

**No social scraping**:

- Draw from recent local news, government/official web sources, and the public web pages of community advocacy groups (association newsletters, BIA pages, neighborhood-council minutes — these are org/gov sites, not social platforms). Do NOT attempt to scrape social media platforms (Twitter/X, Facebook, NextDoor, Reddit, etc.) — those platforms block automated access and the signal is unreliable.

**Source integrity**:

- Every `source_id` referenced in `detail.overview.source_ids`, `detail.history.source_ids`, `detail.research.source_ids`, `detail.legislation.source_ids`, and `detail.quotes[].items[].source_id` MUST resolve to an entry in `detail.sources[]` with a matching `id`.
- Deduplicate `detail.sources[]` by URL before assembling.
- `source_type` is one of `news` (incl. letters/op-eds), `advocacy_org` (community associations, BIAs, neighborhood councils, coalitions), `government_website`, `poll`, or `research`. There is no `social_media` value — trending draws from news, official, and advocacy-group sources only.
- `detail.overview` is always required — never omit it.

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
PARAMS = json.loads(os.environ["PARAMS_JSON"])
ORG_SLUG = PARAMS["organization_slug"]
STATE = PARAMS["state"]
OFFICE = PARAMS["office"]
DISTRICT = PARAMS["district_descriptor"]
RUN_ID = os.environ.get("RUN_ID", "unknown")
```

### Step 2 — Read current issue feed

Call `GET_community_issues` with `organization_slug=ORG_SLUG`. Record every existing issue: capture `id`, `title`, and `category` for each. You will use these IDs in Step 6 to carry issues forward.

### Step 3 — Broad news discovery

Run a handful of `WebSearch` queries:

- `"<DISTRICT>" local issues news 2026`
- `"<DISTRICT>" community concerns site:*.gov OR site:*.org 2026`
- `"<DISTRICT>" <OFFICE> agenda 2026`
- `"<DISTRICT>" neighborhood association OR community association OR BIA OR neighborhood council`
- `"<DISTRICT>" letter to the editor OR op-ed 2026`

Collect candidate topics. Aim for 15-20 candidates before filtering down to the top 10. For any advocacy group, record its name and any political-party affiliation; **prefer nonpartisan groups**, and require a second independent source before a partisan group's framing becomes a trending issue on its own.

### Step 4 — Verify and retrieve sources per candidate

For each candidate topic, verify at least one source URL:

```python
from pmf_runtime import http
r = http.head(url)
if r["status"] in (403, 405):
    r = http.get(url)
# If r["status"] != 200: drop this source
```

Extract: source name, publisher, article_date, and a representative text snippet (≤ 2000 chars) for `retrieved_text_or_snapshot`.

Fast-bail rule: if a topic has no verifiable URL after 2 searches, skip it.

### Step 5 — Select and rank top issues

Rank candidates by:

1. Recency (articles within last 30 days score highest)
2. Coverage breadth (multiple independent sources)
3. Relevance to the district (local vs. national story)

Select up to 10. If fewer than 3 pass the threshold, proceed to thin-signal handling.

### Step 6 — Carry existing issue IDs

Compare each output issue title/category against the existing feed from Step 2. When the issue clearly maps to an existing record, set `existing_issue_id` to that record's ID. Do not invent a mapping if it is ambiguous.

### Step 7 — Assemble artifact

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

```bash
python3 /workspace/validate_output.py
```

Fix any schema violations before declaring success.

## Spot-check

After validation passes, verify:

- **All sources have article dates within the last 90 days.** Older articles indicate a stale search — re-run with a more recent date filter.
- **Issues span at least 2 different categories** (unless the district has a single dominant crisis). Monoculture output suggests the search queries were too narrow.
- **Each `source_id` referenced in `source_ids` / `source_id` fields resolves to an entry in `detail.sources[]`.** A dangling ID means the validator missed it but the downstream renderer will break.
- **`detail.overview` is present on every issue.** It is always required.
- **`list` is set to `"trending"`.** Not `"top_community"`.
- **No fabricated news URLs.** Verify at least 3 issue URLs returned HTTP 200 via `head`.
- **No social media sources in `detail.sources[]`.** Sources are news, government/official, or `advocacy_org` (community-group web pages) only — never scraped social platforms.
- **Advocacy-group framing is nonpartisan or flagged.** Any partisan group's claim is corroborated by an independent source before it becomes a trending issue.

## Failure modes

| Symptom                                      | Cause                                                       | Fix                                                                      |
| -------------------------------------------- | ----------------------------------------------------------- | ------------------------------------------------------------------------ |
| All sources are > 90 days old                | Date filter not applied to searches                         | Re-run searches with `2026` or `site:` filter for local news             |
| Fewer than 3 issues found                    | Small/rural district with thin local news coverage          | Set `data_quality: "insufficient_signal"`; emit what you have            |
| `source_id` not found in `detail.sources[]`  | Forgot to add the source entry after referencing it         | Add matching entry to `detail.sources[]`                                 |
| Validator: missing required field `overview` | `detail.overview` was omitted                               | Always emit `overview`; it is required                                   |
| `WebFetch` returns domain-safety error       | Used `WebFetch` instead of `WebSearch` + `pmf_runtime.http` | Use `WebSearch` for discovery; `pmf_runtime.http.head/get` for retrieval |
| `GET_community_issues` 404            | Organization has no feed yet                                | Treat as empty feed; proceed with empty existing_issue_ids               |
