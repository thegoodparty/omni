<!-- The schemas in manifest.json are the stable contract. This prose encodes the method; the JSON Schema is what the validator enforces. -->

# Self Research

Research the candidate's **own** public record the way a sharp opponent would, so the candidate is never surprised. Produce a list of **vulnerabilities** — things in the candidate's public conduct an opponent could attack — and, for each one, a short drafted response. The artifact is `{ "generated_at": ..., "findings": [...] }`.

This is the OPPOSITE of a fast "who is in the race" scan. Research **deeply**: discover sources, **fetch and verify** each one, and emit a finding ONLY when a verbatim passage from the fetched page substantiates it. **Sourced or silent** — a finding with no verifiable `source_extract` on a real `source_url` does not ship.

## What counts as a finding (this drives everything)

A finding is a **specific, sourced vulnerability in the candidate's own public record** — a vote, a public statement, a donation, a business interest, a residency question, a gap between the campaign narrative and the record. Each finding names the concrete instance and carries the verbatim source passage that proves it, plus a drafted response.

**Only the candidate's own PUBLIC conduct.** Votes, public statements, filings, donations, public business dealings, and on-the-record positions. Nothing else.

## Categories

Each finding is tagged with exactly one `category`:

- `residency` — questions about whether the candidate lives in / is eligible for the district.
- `record` — votes, official actions, attendance, decisions in a prior public role.
- `statements` — on-the-record public statements, op-eds, social posts that could be used against them.
- `funding` — donations made or received, financial disclosures, fundraising sources.
- `conflicts` — business interests, employment, or relationships that create a conflict of interest.
- `narrative` — a gap or contradiction between the campaign's story and the documented record.

## The hard "never do" allowlist

These are absolute. A finding that touches any of these is dropped, never emitted:

- **No family, no health, no private life.** Spouse, children, relatives, medical history, personal relationships, private residence details beyond the public residency/eligibility question — all off-limits.
- **No rumor, no innuendo, no anonymous claims.** If it is not on the record from a fetched, verifiable source, it does not exist.
- **Only the candidate's OWN public conduct.** Never another person's conduct attributed to the candidate.
- **No fabrication.** Never invent a vote, statement, donation, date, or URL. If you cannot fetch a page and confirm the quote literally appears on it, drop the finding.

## BEFORE YOU START

1. Read this entire instruction end-to-end before executing anything.
2. Maintain a TodoWrite list mirroring the TODO CHECKLIST below.
3. Your params are in the `PARAMS_JSON` env var. Read them once at the top.
4. Write the final artifact to `/workspace/output/self_research.json` and nowhere else.
5. Run `python3 /workspace/validate_output.py` before declaring success.

## TODO CHECKLIST

1. Read `PARAMS_JSON`; capture `full_name`, `state`, `city`, `office_name`, `prior_roles`, and the hint URLs (Step 0).
2. Fan out one researcher subagent per category to discover and fetch sources (Step 1).
3. For every candidate finding, `verify_quote` the `source_extract` against the fetched page; DROP any that fails (Step 2).
4. Draft a short response for each surviving finding (Step 3).
5. Assemble the artifact and write it (Step 4).
6. Validate (Step 5).

## Inputs (the params in `PARAMS_JSON`)

- `full_name` (string): the candidate. The person this is FOR.
- `state` (2-letter string): used to disambiguate the right person/jurisdiction.
- `city` (string|null): jurisdiction, when known.
- `office_name` (string): the office the candidate is running for.
- `prior_roles` (string[]): prior public roles to seed `record` and `statements` research. May be empty.
- `website_url` (string|null), `social_urls` (string[]), `coverage_urls` (string[]): optional footprint hints — fetch these directly and discover more via WebSearch.

## CRITICAL RULES

- **WebSearch discovers URLs; `pmf_runtime.http.get` fetches them.** Use `WebSearch` to find candidate sources (campaign site, social, local news, prior-office records, campaign-finance portals). Then fetch the page body with `pmf_runtime.http.get(url)` — it returns a plain dict `{"status", "headers", "body", "source_url"}` (use `r["status"]` / `r["body"]`, never `.status_code` / `.text`). The `source_url` it returns is the broker's `X-Source-URL` after any redirect — **cite THAT** as the finding's `source_url`, not the URL you requested.

  ```python
  from pmf_runtime import http
  r = http.get("https://example.com/article")
  body = r["body"]            # the rendered page text
  fetched_url = r["source_url"]  # X-Source-URL — cite this
  ```

- **`verify_quote` is the gate.** Before emitting any finding, confirm the `source_extract` appears **literally** in the fetched page `body` (a normalized substring match — collapse whitespace, lowercase both sides). If it does not appear verbatim, the finding is unverified — **DROP IT**. Sourced or silent.
- **Never make a direct network call from Python or the shell** — `urllib`/`requests`/`httpx`/`curl`/`wget`/raw `socket`. The container has NO direct egress; these HANG ~30s+ each and burn the budget. `WebSearch` + `pmf_runtime.http` are the only ways to reach the outside world.
- **Confirm identity.** Before trusting a fetched page, confirm it is about THIS candidate in THIS race — same name AND (office or jurisdiction). A same-named person elsewhere is not the candidate; drop their content.
- **Honor the "never do" allowlist above** on every finding. Family/health/private life, rumor, and another person's conduct are out, no matter how well-sourced.
- **The only PUBLISHED artifact is `/workspace/output/self_research.json`.** You may write intermediate files to `/workspace/scratch/` — never published.
- **Run `python3 /workspace/validate_output.py` before declaring success.**

## Steps

### Step 0 — Read params

```python
import json, os
PARAMS = json.loads(os.environ["PARAMS_JSON"])
FULL_NAME = PARAMS["full_name"]
STATE = PARAMS["state"]
CITY = PARAMS.get("city")
OFFICE = PARAMS["office_name"]
PRIOR_ROLES = PARAMS.get("prior_roles") or []
HINTS = [PARAMS.get("website_url")] + (PARAMS.get("social_urls") or []) + (PARAMS.get("coverage_urls") or [])
HINTS = [u for u in HINTS if u]
mkdir = os.makedirs("/workspace/scratch", exist_ok=True)
```

### Step 1 — Fan out one researcher per category

Dispatch up to `max_parallel_subagents` (6) researcher subagents in parallel via the `Agent` tool — **one per category** (`residency`, `record`, `statements`, `funding`, `conflicts`, `narrative`). Each researcher inherits your tools (WebSearch, `pmf_runtime.http`) and is given `full_name`, `state`, `city`, `office_name`, `prior_roles`, and the hint URLs.

Each researcher:
1. `WebSearch` to discover sources for its category (e.g. for `record`: prior-office vote records, council minutes, the candidate's voting history; for `funding`: state/FEC campaign-finance portals; for `statements`: the candidate's site, social, op-eds, local news quotes).
2. `pmf_runtime.http.get` each promising URL, capture `body` and `source_url`.
3. Confirm the page is about THIS candidate in THIS race.
4. For each vulnerability it finds, pull a **verbatim** passage from the fetched `body` as the `source_extract` and record `{claim, source_url (the returned source_url), source_extract, category, source_title?, occurred_at?}`.
5. Return its candidate findings to you. Never emit a finding the page text does not literally support.

### Step 2 — Verify every candidate finding (the hard gate)

For each candidate finding from every researcher, re-confirm the `source_extract` literally appears in the fetched page. Normalize both sides (collapse whitespace, lowercase) and require a substring match:

```python
import re
def normalize(s): return re.sub(r"\s+", " ", s).strip().lower()
def verify_quote(extract, body): return normalize(extract) in normalize(body)
```

If `verify_quote` is False, **DROP the finding**. A finding that cannot be grounded does not ship. Also drop any finding that violates the "never do" allowlist (family/health/private life, rumor, another person's conduct).

### Step 3 — Draft a response per surviving finding

For each finding that survived verification, write a short, honest `drafted_response` the candidate could use if attacked on it — first person or neutral, grounded in the same facts, no spin. A few sentences at most.

### Step 4 — Assemble

```python
import json
from datetime import datetime, timezone
artifact = {
    "generated_at": datetime.now(timezone.utc).isoformat(),
    "findings": findings,  # only verified, allowlist-clean findings
}
with open("/workspace/output/self_research.json", "w") as f:
    json.dump(artifact, f, indent=2)
```

An empty `findings` array is a valid, honest result when nothing surfaced — never pad it.

### Step 5 — Validate

```bash
python3 /workspace/validate_output.py
```

Fix any schema violations before declaring success.

## Constraints (must follow)

- Plain, direct U.S. English. No em dashes.
- Every finding is grounded: `source_extract` literally appears on `source_url`. No fabricated claims, quotes, dates, or URLs.
- Emit ONLY the `{ "generated_at": ..., "findings": [...] }` artifact — no markdown, no preamble, no extra top-level fields.
- Only the candidate's own public conduct. Honor the "never do" allowlist on every finding.

## Failure modes

| Symptom | Cause | Fix |
|---|---|---|
| A Bash command hangs ~30s then fails | A direct network call (`curl`/`requests`/`urllib`) — the container has no direct egress | Never make direct network calls; use `WebSearch` + `pmf_runtime.http` |
| A finding cites a URL but the quote isn't on the page | Skipped `verify_quote`, or cited the requested URL instead of the returned `source_url` | Re-fetch, verify the extract literally appears, cite `r["source_url"]`; otherwise drop the finding |
| A finding is about a relative / health / private life | Crossed the allowlist | Drop it — only the candidate's own public conduct |
| A finding is about a same-named person elsewhere | Identity not confirmed | Confirm name + office/jurisdiction before trusting a page; drop mismatches |
| `No artifact files found in /workspace/output` | Never wrote the file | Write `/workspace/output/self_research.json`, confirm it exists |
