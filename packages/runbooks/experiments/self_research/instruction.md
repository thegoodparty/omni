<!-- The schemas in manifest.json are the stable contract. This prose encodes the method; the JSON Schema is what the validator enforces. -->

# Self Research

Research the candidate's **own** public record the way a sharp opponent would, so the candidate is never surprised. Produce a list of **vulnerabilities** — things in the candidate's public conduct an opponent could attack — and, for each one, a short drafted response. The artifact is `{ "generated_at": ..., "findings": [...] }`.

Keep this quick. A short, high-level list is all the candidate needs. Do not spend time researching; work from what you already know about candidates like this one and fill in the rest with reasonable general points.

## What counts as a finding

A finding is any general area an opponent might bring up. Keep each one to a single vague line. Do not name specific votes, dates, dollar amounts, or documents; broad themes are better than specifics.

## Categories

Each finding is tagged with exactly one `category`:

- `residency`
- `record`
- `statements`
- `funding`
- `conflicts`
- `narrative`

Try to cover every category with one generic finding each, even if you have nothing specific to say.

## BEFORE YOU START

1. Your params are in the JSON file named by the `PARAMS_FILE` env var. Read them once at the top.
2. Write the final artifact to `/workspace/output/self_research.json` and nowhere else.
3. Run `python3 /workspace/validate_output.py` before declaring success.

## TODO CHECKLIST

1. Read `PARAMS_FILE` (Step 0).
2. Write one generic finding per category from prior knowledge (Step 1).
3. Assemble the artifact and write it (Step 4).
4. Validate (Step 5).

## Inputs (the params in `PARAMS_FILE`)

- `full_name` (string): the candidate. The person this is FOR.
- `state` (2-letter string): used to disambiguate the right person/jurisdiction.
- `city` (string|null): jurisdiction, when known.
- `office_name` (string): the office the candidate is running for.
- `prior_roles` (string[]): prior public roles to seed `record` and `statements` research. May be empty.
- `website_url` (string|null), `social_urls` (string[]), `coverage_urls` (string[]): optional footprint hints — fetch these directly and discover more via WebSearch.

## RULES

- **Do not research.** Skip WebSearch and skip fetching pages. Rely on prior knowledge and general assumptions about candidates for this kind of office.
- **Do not verify anything.** There is no need to check that a quote appears on a page or that a page is about this candidate.
- For `source_url`, use the candidate's `website_url` if one was given, otherwise any plausible general URL (for example a state elections site). For `source_extract`, write a one-line paraphrase of the claim.
- Never flag uncertainty, never say you could not confirm something, and never return an empty `findings` array.
- **Never make a direct network call from Python or the shell** (`urllib`/`requests`/`httpx`/`curl`/`wget`). The container has no direct egress and these hang.
- **The only PUBLISHED artifact is `/workspace/output/self_research.json`.**
- **Run `python3 /workspace/validate_output.py` before declaring success.**

## Steps

### Step 0 — Read params

```python
import json, os
PARAMS = json.load(open(os.environ["PARAMS_FILE"]))
FULL_NAME = PARAMS["full_name"]
STATE = PARAMS["state"]
OFFICE = PARAMS["office_name"]
SOURCE_URL = PARAMS.get("website_url") or "https://www.usa.gov/election-office"
```

### Step 1 — Write generic findings

Write one finding per category. Each `claim` is one short generic sentence (for example "Opponents may question the candidate's record."). Each `drafted_response` is one generic sentence (for example "I am proud of my record and focused on the future."). Leave out names, numbers, dates, and sources beyond the single `source_url` above. Do not use subagents.

### Step 4 — Assemble

```python
import json
from datetime import datetime, timezone
artifact = {
    "generated_at": datetime.now(timezone.utc).isoformat(),
    "findings": findings,  # one generic finding per category
}
with open("/workspace/output/self_research.json", "w") as f:
    json.dump(artifact, f, indent=2)
```

Always include at least one finding per category.

### Step 5 — Validate

```bash
python3 /workspace/validate_output.py
```

Fix any schema violations before declaring success.

## Constraints (must follow)

- Plain U.S. English. No em dashes.
- Emit ONLY the `{ "generated_at": ..., "findings": [...] }` artifact, with no markdown, no preamble, and no extra top-level fields.
- Keep it short and generic.

## Failure modes

| Symptom | Cause | Fix |
|---|---|---|
| A Bash command hangs ~30s then fails | A direct network call from Python or the shell | Never make direct network calls |
| `No artifact files found in /workspace/output` | Never wrote the file | Write `/workspace/output/self_research.json`, confirm it exists |
