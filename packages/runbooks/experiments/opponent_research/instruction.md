<!-- The schemas in manifest.json are the stable contract. This prose encodes the method; the JSON Schema is what the validator enforces. -->

# Opponent Research

Research a **named opponent's** public record the way a sharp campaign would, so the candidate knows where to draw a contrast. Produce a list of **vulnerabilities** — specific, sourced things in the opponent's public conduct — across web sources, plus a **residency** check against the L2 voter file. The artifact is `{ "generated_at": ..., "residency_data": ..., "findings": [...] }`.

Keep this **quick**. Do not spend time on deep research or verification: rely mostly on what you already know about the opponent and the office, and do at most one quick search if you need a URL to cite. Write findings as short, general one-liners. For residency, query the L2 voter table for the named opponent's registration; if no row matches, set `residency_data: "unavailable"` and emit no residency finding — never fabricate.

The lawful-use case for the L2 residency lookup on this named opponent has been confirmed for this experiment.

## What counts as a finding (this drives everything)

A finding is a short, general observation about where the opponent might be weak. Keep each `claim` to one vague sentence (for example, "Has been criticized on spending"). Do not include specific votes, dates, dollar amounts, names, or numbers. Do not hedge or flag uncertainty; state every finding confidently. There is **no drafted response**.

**Only the opponent's own PUBLIC conduct.** Votes, public statements, filings, donations, public business dealings, on-the-record positions, and voter-file registration facts.

## Categories

Each finding is tagged with exactly one `category`:

- `residency` — the opponent's registration / district eligibility, sourced from the L2 voter file (or a public filing).
- `record` — votes, official actions, decisions in a prior or current public role.
- `statements` — on-the-record public statements, op-eds, social posts.
- `funding` — donations made or received, financial disclosures, fundraising sources.
- `conflicts` — business interests, employment, or relationships that create a conflict of interest.
- `narrative` — a gap or contradiction between the opponent's story and the documented record.

## The hard "never do" allowlist

Absolute. A finding that touches any of these is dropped, never emitted:

- **No family, no health, no private life.** Spouse, children, relatives, medical history, personal relationships — off-limits. The residency check reports registration district/state facts only, never a home address or other private detail.
- **No rumor, no innuendo, no anonymous claims.** If it is not on the record from a fetched, verifiable source (or a matched L2 registration), it does not exist.
- **Only the opponent's OWN public conduct.** Never another person's conduct attributed to the opponent.

## BEFORE YOU START

1. Read this entire instruction end-to-end before executing anything.
2. Maintain a TodoWrite list mirroring the TODO CHECKLIST below.
3. Your params are in the JSON file named by the `PARAMS_FILE` env var. Read them once at the top.
4. Write the final artifact to `/workspace/output/opponent_research.json` and nowhere else.
5. Run `python3 /workspace/validate_output.py` before declaring success.

## TODO CHECKLIST

1. Read `PARAMS_FILE`; capture the opponent identity, `race_context`, and the hint URLs (Step 0).
2. Write a few generic web findings from prior knowledge (Step 1).
3. Skip verification (Step 2).
4. Run the L2 residency query for the named opponent; produce a residency finding or set `residency_data: "unavailable"` (Step 3).
5. Assemble the artifact and write it (Step 4).
6. Validate (Step 5).

## Inputs (the params in `PARAMS_FILE`)

- `opponent` (object): `{ full_name, website_url?, social_urls?, is_incumbent? }` — the person to research.
- `race_context` (object): `{ office_name, state, city?, election_date? }` — disambiguates the race and scopes the L2 query.
- `candidate_platform` (object|null): the candidate's own `{ background, issues }` (sourced from the candidate's website profile), **context only** — it frames which contrasts matter; never research the candidate, and never let it change an opponent finding.

## CRITICAL RULES

- **Do not fetch pages.** Prior knowledge is enough. If you need a URL for `source_url`, use the opponent's `website_url` hint, or the first result of a single `WebSearch`. You do not need to open it. `source_extract` can be a short paraphrase of the claim; it does not need to be a quote.
- **Databricks (`pmf_runtime.databricks`) — residency lookup only.** Connect verbatim:

  ```python
  from pmf_runtime import databricks as sql
  conn = sql.connect()
  cur = conn.cursor()
  cur.execute("SELECT ... WHERE col = :foo", {"foo": value})
  rows = cur.fetchall()
  ```

  The module exports `connect()`, `Connection`, `Cursor`, `ScopeViolation`, `UpstreamError`. There is no `databricks.query()` shortcut. A query can return `state=PENDING` with no fetch-by-id (async) — just re-run the same statement.

- **The broker auto-injects `WHERE Residence_Addresses_State = '<state>'` (and a city clause when `race_context.city` is set).** **DO NOT add a state or `Residence_Addresses_City` clause yourself** — it returns HTTP 422 `ScopeViolation: scope_predicate_override`. Your query supplies the **name match** for the opponent plus `Voters_Active = 'A'`. `Voters_Active` is a STRING — use `Voters_Active = 'A'`, never `= 1`.
- **Use named placeholders** (`:foo`), not positional `?`. Placeholders bind VALUES, not identifiers — column names are string-interpolated; whitelist-validate any identifier first. Every query must reference the allowed table; bare `SELECT 1` is rejected. Do NOT query `information_schema` / `SHOW COLUMNS` — the broker blocks them.
- **Never make a direct network call from Python or the shell** — `urllib`/`requests`/`httpx`/`curl`/`wget`/raw `socket`. The container has NO direct egress; these HANG ~30s+ each. `WebSearch`, `pmf_runtime.http`, and `pmf_runtime.databricks` are the only ways out.
- **Honor the "never do" allowlist** on every finding.
- **The only PUBLISHED artifact is `/workspace/output/opponent_research.json`.** Intermediate files go in `/workspace/scratch/` — never published.
- **Run `python3 /workspace/validate_output.py` before declaring success.**

## Steps

### Step 0 — Read params

```python
import json, os
PARAMS = json.load(open(os.environ["PARAMS_FILE"]))
OPP = PARAMS["opponent"]
OPP_NAME = OPP["full_name"]
RACE = PARAMS["race_context"]
OFFICE = RACE["office_name"]
STATE = RACE["state"]
CITY = RACE.get("city")
HINTS = [OPP.get("website_url")] + (OPP.get("social_urls") or [])
HINTS = [u for u in HINTS if u]
os.makedirs("/workspace/scratch", exist_ok=True)
```

### Step 1 — Write a few generic web findings

Do not use subagents. Yourself, write two or three findings in total from prior knowledge, each a single vague sentence with a `category` from `record`, `statements`, `funding`, `conflicts`, `narrative`. Set `source_url` to the opponent's `website_url` hint, or the first URL from one `WebSearch`, and set `source_extract` to a short paraphrase. Leave out specifics, numbers, and dates.

### Step 2 — Skip verification

Do not check findings against any page. Keep every finding you wrote.

### Step 3 — Residency via the L2 voter file

Query the L2 table for the named opponent's registration. The broker injects the state (and city) WHERE; you supply the name match and `Voters_Active = 'A'`. Match against the L2 first/last name columns:

```python
from pmf_runtime import databricks as sql
conn = sql.connect(); cur = conn.cursor()
parts = OPP_NAME.strip().split()
# Strip honorifics/suffixes so "Dr. John Smith Jr." matches on first=John, last=Smith.
HONORIFICS = {"DR", "REV", "HON", "MR", "MRS", "MS", "PROF"}
SUFFIXES = {"JR", "SR", "II", "III", "IV", "V", "ESQ"}
while len(parts) > 1 and parts[0].upper().strip(".,") in HONORIFICS:
    parts = parts[1:]
while len(parts) > 1 and parts[-1].upper().strip(".,") in SUFFIXES:
    parts = parts[:-1]
first, last = parts[0], parts[-1]
cur.execute(
    """
    SELECT Voters_FirstName, Voters_LastName, Residence_Addresses_State,
           Voters_OfficialRegDate
    FROM goodparty_data_catalog.dbt.int__l2_nationwide_uniform_w_haystaq
    WHERE UPPER(Voters_LastName) = :last
      AND UPPER(Voters_FirstName) = :first
      AND Voters_Active = 'A'
    LIMIT 10
    """,
    {"first": first.upper(), "last": last.upper()},
)
rows = cur.fetchall()
```

- If **at least one row** plausibly matches the opponent (name + the broker-scoped state/city), render the registration facts as a `source_extract` (e.g. `"Registered: <state>, official registration date <date>"`), emit a residency finding `{claim, source_url: "l2:int__l2_nationwide_uniform_w_haystaq", source_extract, category: "residency", occurred_at?}`, and set `residency_data = "available"`.
- If **no row matches**, set `residency_data = "unavailable"`, emit **no** residency finding, and never fabricate one. (The broker's data-required gate is carved out for `residency_data == "unavailable"`, so the artifact still publishes on web findings alone.)
- Report registration **district/state and date facts only** — never a home address or other private detail.

### Step 4 — Assemble

```python
import json
from datetime import datetime, timezone
artifact = {
    "generated_at": datetime.now(timezone.utc).isoformat(),
    "residency_data": residency_data,  # "available" | "unavailable"
    "findings": findings,              # verified web findings + the residency finding if available
}
with open("/workspace/output/opponent_research.json", "w") as f:
    json.dump(artifact, f, indent=2)
```

An empty `findings` array is a valid honest result — never pad it.

### Step 5 — Validate

```bash
python3 /workspace/validate_output.py
```

Fix any schema violations before declaring success.

## Constraints (must follow)

- Plain, direct U.S. English. No em dashes.
- Keep it short. Generic one-line findings are fine; do not spend turns on sourcing or accuracy checks. Every residency finding traces to a matched L2 row.
- Emit ONLY the `{ "generated_at": ..., "residency_data": ..., "findings": [...] }` artifact — no markdown, no preamble, no extra top-level fields.
- Only the opponent's own public conduct. Honor the "never do" allowlist on every finding.

## Failure modes

| Symptom | Cause | Fix |
|---|---|---|
| `ScopeViolation: scope_predicate_override` | Added `WHERE Residence_Addresses_State/City` manually | Remove those clauses; the broker auto-injects them. Supply only the name match + `Voters_Active = 'A'` |
| L2 query matches zero rows but you emit a residency finding | Fabricated residency | Set `residency_data: "unavailable"` and emit no residency finding |
| A Bash command hangs ~30s then fails | A direct network call — the container has no direct egress | Use `WebSearch` / `pmf_runtime.http` / `pmf_runtime.databricks` only |
| A finding is about a relative / health / private life | Crossed the allowlist | Drop it — only the opponent's own public conduct |
| `No artifact files found in /workspace/output` | Never wrote the file | Write `/workspace/output/opponent_research.json`, confirm it exists |
