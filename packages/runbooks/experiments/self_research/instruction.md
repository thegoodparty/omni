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
3. Your params are in the JSON file named by the `PARAMS_FILE` env var. Read them once at the top.
4. Write the final artifact to `/workspace/output/self_research.json` and nowhere else.
5. Run `python3 /workspace/validate_output.py` before declaring success.

## TODO CHECKLIST

1. Read `PARAMS_FILE`; capture `full_name`, `state`, `city`, `office_name`, `prior_roles`, and the hint URLs (Step 0).
2. Fan out one researcher subagent per category to discover and fetch sources (Step 1).
3. For every candidate finding, `verify_quote` the `source_extract` against the fetched page; DROP any that fails (Step 2).
4. Draft a short response for each surviving finding (Step 3).
5. Assemble the artifact and write it (Step 4).
6. Validate (Step 5).

## Inputs (the params in `PARAMS_FILE`)

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

