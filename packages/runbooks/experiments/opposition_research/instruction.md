# Opposition Research

Validate **who is running in this race**. Produce one record per opponent with just the essentials: full name, party affiliation, and incumbent status. The artifact is `{ "opponents": [...] }`; gp-api renders the `### Opposition Research` section from it. You combine two signals: the candidate roster inside the `campaign_strategy_context` handed to you in params (gp-api hydrated it from election-api before dispatch) and a light web-search cross-check that catches late filers, write-ins, and independents the roster misses.

This experiment does **NOT** profile opponents. No candidate summaries, no key facts, no websites, no fetching or verifying URLs. The whole point is to be fast - identify the field and stop.

## BEFORE YOU START
1. Read this entire instruction end-to-end before executing anything.
2. Maintain a TodoWrite list mirroring the TODO CHECKLIST below.
3. Your params are in the `PARAMS_JSON` env var. Read them once at the top.
4. Write the final artifact to `/workspace/output/opposition_research.json` and nowhere else.
5. Run `python3 /workspace/validate_output.py` before declaring success.

## TODO CHECKLIST
1. Read `PARAMS_JSON`; identify the candidate (`is_user`) and build the seed opponent list from the general + primary rosters (Step 0).
2. Run AT MOST 2 WebSearch queries to catch late filers; race-match-gate and merge any confirmed adds (Step 1).
3. Write the opponent list + `_race.json`, run `assemble.py` (Step 2).
4. Validate (Step 3).

## Inputs (the params in `PARAMS_JSON`)
Every field gp-api provides. Fill in the glossary term for each value where one applies (leave blank where there is no term).

**Top level**
- `race_id` (string): BallotReady brHashId, trace id only.
- `user_email` (string): candidate email, used for the is_user match.
- `user_first_name` (string|null).
- `user_last_name` (string|null).
- `user_full_name` (string): candidate name.
- `user_party_affiliation` (string|null): candidate party label; "Other" means see other_party.
- `other_party` (string|null): candidate party when affiliation is "Other".
- `campaign_strategy_context` (object): the GENERAL-election context (fields below). We are focused on the general elections.
- `campaign_primary_strategy_context` (object|null): the PRIMARY-stage roster only (fields below); null if no primary. Not the campaign we are targeting, but data may be valuable.
- `campaign_story` (object): the candidate's own story (fields below) — first-person positioning context about the person you write FOR, NOT opponent data. Any field may be null when unwritten.

**`campaign_strategy_context` (general election)**
- `candidate_count` (int): count of the general roster.
- `candidate_office` (string|null): readable office name.
- `candidates[]`: general roster; each row {gp_candidate_id, first_name, last_name, full_name, email, website_url, party, is_incumbent}.
- `contacts_needed_estimate` (int|null): always refer to this field as "targeted voter contact goal". Never say "contacts needed estimate". A voter contact is a contact attempt that reaches an intended voter via a channel capable of conveying the message (delivered text, answered call, in-person conversation). The "targeted voter contact goal" is the number of voter contacts we estimate the candidate will need to win, which is equal to 5 times win_number_effective.
- `filing_date_end` (date|null).
- `general_election_date` (date|null): the date we want to focus on.
- `number_of_seats` (int|null): how many seats this contest elects. Most races fill 1. When it is greater than 1, the top N vote-getters win rather than a single majority winner.
- `office_level` (string|null).
- `office_type` (string|null).
- `official_office_name` (string|null).
- `partisan_type` (string|null): 'partisan' or 'nonpartisan': whether this office is contested on a partisan or nonpartisan basis. partisan means candidates run under party labels and the race is organized by party (party primaries feeding a general election). nonpartisan means the contest is not organized by party. May be null when unknown.
- `primary_election_date` (date|null): the date of the primary. This is not our priority, but worth noting.
- `projected_turnout` (int|null): The estimated number of registered voters expected to cast a ballot in this specific general election, derived from a turnout model applied to recent comparable cycles. Historically our projections have been +/- 1.5% of actual voter turnout. This number does NOT represent a primary election and is for the general election.
- `relevant_election_date` (date|null): the date of THIS race's stage.
- `state` (2-letter string|null).
- `win_number_effective` (int|null): Only refer to this field value as "projected votes needed to win", which is the total votes a candidate is targeting to win - a simple majority (50% + 1) of the projected voter turnout in their race, for the general election.
- `registered_voters` (int|null): The total pool of voters eligible to cast a ballot for a race, pulled from the latest voter file.
- `unique_cellphones` (int|null): Number of unique cellphone numbers known for within the district.
- `unique_landlines` (int|null): Number of unique landline numbers known for within the district.

**`campaign_primary_strategy_context` (primary stage, or null)**
- `candidate_count` (int): count of the primary roster.
- `candidates[]`: primary roster, same row shape as the general candidates.

**`campaign_story` (the candidate's own framing — context only)**
- `why` (string|null): why the candidate is running.
- `background` (string|null): the candidate's background, career, community ties.
- `issues` (string|null): the issues the candidate will fight for.

## CRITICAL RULES
- **WebSearch is your ONLY outside-world tool, and it is HARD-CAPPED at 2 queries total.** Use it only to catch late filers the roster missed. After 2 searches your opponent list is final. Do NOT keep opening sample-ballot / county-clerk / Secretary-of-State / petition pages to confirm or rule out a name (e.g. whether an incumbent re-filed). Chasing an empty field past the cap is what made this experiment slow - a fast result is correct, a timeout is not.
- **Do NOT fetch or verify any URL, and do NOT output websites.** This experiment no longer profiles opponents, vets links, or emits campaign URLs. Never use `pmf_runtime.http.head` / `.get` / `.download`, never `WebFetch`. There is nothing to fetch.
- **Never make a direct network call from Python or the shell** - `urllib`/`requests`/`httpx`/`curl`/`wget`/raw `socket`. The container has NO egress; these do not fail fast, they HANG ~30s+ each and burn the time budget. `WebSearch` is the only way to reach the outside world.
- **Do NOT call election-api or any other internal API.** The candidate roster is already in `PARAMS.campaign_strategy_context.candidates` (and `campaign_primary_strategy_context.candidates`). You derive the opponent list from those in Step 0.
- **`campaign_story` describes the CANDIDATE, not opponents.** It is the candidate's own why/background/issues. Use it only as background to recognize and exclude the candidate correctly; never treat it as opponent data, never let it change any opponent's name/party/incumbent status, and never invent opponents or facts from it.
- **The only PUBLISHED artifact is `/workspace/output/opposition_research.json`.** You may write intermediate files to `/workspace/scratch/` - that directory is never published.
- **Run `python3 /workspace/validate_output.py` before declaring success.**

## Steps

### Step 0 - Read params, identify the candidate, build the seed opponent list

Read `PARAMS_JSON` once. The candidate you write FOR is `user_full_name`; `office_name` = `campaign_strategy_context.candidate_office` (fallback `official_office_name`, used for web search); `state` / `electionDate` = the context's `state` / `relevant_election_date`. (`race_id` is a trace id - ignore it; you never call election-api.)

The roster is `campaign_strategy_context.candidates[]` and it INCLUDES the candidate. `campaign_primary_strategy_context` carries only the PRIMARY stage's roster (`candidate_count` + `candidates`), or is `null` when the race has no primary. **You are handed both rosters on purpose: our data lags reality and the timing varies** - this can run before OR after the primary, so the general roster is often empty or stale before the field settles, while the primary roster usually has the real filed names. Treat both as evidence and **use judgment to build the list of who is actually running against the candidate in this (general) election.** Do not blindly merge the two.

Build the seed opponent list:
1. **Find the candidate's own row via `is_user`** - match `user_email` to `candidates[].email` (case-insensitive + trimmed; fall back to a fuzzy `full_name` match using the same normalization as dedup below: normalize case, strip middle initials / suffixes / accents). Exclude the candidate from the opponent list.
2. **Decide each remaining person's relevance using both rosters and your judgment.** Two calls to make:
   - The general roster lags, so pull in names from the primary roster when the general roster is thin or empty.
   - **In a partisan race (`partisan_type == "partisan"`) the primary roster spans ALL parties' primaries.** Someone contesting a DIFFERENT party's primary is not a general-election opponent (only the eventual nominees are), so do not list them. In a **nonpartisan** race the primary roster IS the field, so include it. Use `partisan_type` and the candidate's `user_party_affiliation` (both in PARAMS) to make this call.
3. For each person you keep, use their `full_name`, `party`, and `is_incumbent` (ignore the other roster fields).
4. **Dedupe** across the two rosters by fuzzy name (normalize case, strip middle initials / suffixes / accents) - the same person can appear in both.
5. **Drop obvious test/junk rows** - placeholder names like "Jack Test", `@goodparty.org` / `+tag` emails.

`partisan_type` is given at `campaign_strategy_context.partisan_type` (read it; do not infer - it may be `null`). It informs the opponent judgment above and the party line in Step 2.

`mkdir -p /workspace/scratch`, then write `/workspace/scratch/_race.json` = `{"candidate_name": <user_full_name>, "partisan_type": <value>}` so the assembler can read them.

### Step 1 - Catch late filers (AT MOST 2 WebSearch queries)

The seed roster is authoritative for known filers but lags reality: late filers, write-ins, and especially independents are often missing. Run AT MOST 2 WebSearch queries to catch them, then stop:
- `candidates running for <office_name> <state> <electionDate>`
- `<office_name> candidates <election year>` or a ballot-info variant, e.g. `<state> sample ballot <office_name> <year>`

Prefer official sources: the county / state board of elections, the local clerk's sample ballot, Ballotpedia's race page, recent local race previews.

**The race MUST line up. A wrong-race candidate is far worse than a missed late filer.** Before adding ANY web-found name, confirm all three from an authoritative roster:
- **Same office** - must match `office_name`, not just the same city or office *type*. "City Council" ≠ "Government Study Commission" ≠ "Mayor".
- **Same jurisdiction** (city / district / subarea) and **same `electionDate`**.
- **Found on an authoritative roster** - county/state board of elections, the clerk's sample ballot, or Ballotpedia's race page for THIS office. A stray news mention is not enough.

**Default-drop on ambiguity:** if you cannot positively confirm all three, DROP the name.

**Merge rules:**
- Skip any name that is the candidate (`candidate_name`), matching loosely.
- Skip any name already among the seed opponents (same fuzzy match) - the seed row is richer.
- Otherwise append `{full_name, party: <if stated, else null>, is_incumbent: null}`.

**Caps:** web search may add AT MOST 3 names beyond the seed; the final list must not exceed **20**. Seed candidates are authoritative filers - keep ALL of them even when web search finds nothing; web silence does not disconfirm a real filing. Web search can only ADD, never remove a seed opponent.

If BOTH rosters (general + primary) and the 2 searches find no opponent other than the candidate, the race is uncontested: write an empty list and go to Step 2 - `{ "opponents": [] }`. Do not keep hunting.

### Step 2 - Assemble

Write the full opponent list (seed + confirmed web adds, candidate excluded) to `/workspace/scratch/opponents.json` as a JSON array. Each entry:

```json
{
  "full_name": "Jane Doe",
  "party": "Democratic | Nonpartisan | null",
  "incumbent": "Yes | No | Unknown"
}
```

- `party` is the opponent's party from the roster row (or what web search stated), else `null`.
- `incumbent`: map the roster `is_incumbent` - `true` -> `"Yes"`, `false` -> `"No"`, `null` -> `"Unknown"`.

Then run the assembler. It reads `opponents.json` + `_race.json` and writes `/workspace/output/opposition_research.json` as `{ "opponents": [...] }`, mapping each entry to `{full_name, party_affiliation, incumbent}` (party normalized to "Nonpartisan" for nonpartisan races). Run it once - do NOT hand-compose the artifact.

```bash
python3 /workspace/assemble.py
```

An uncontested race (empty `opponents.json`) yields `{"opponents": []}`.

### Step 3 - Validate

```bash
python3 /workspace/validate_output.py
```

## Constraints (must follow)
- Plain, direct U.S. English in any party label. No em dashes.
- Grounded in the roster and what web search actually returned. Do not fabricate names, affiliations, or URLs.
- Emit ONLY the structured `{ "opponents": [...] }` artifact - no markdown, no preamble, no extra top-level fields.
- The candidate is excluded from `opponents` entirely (via `is_user`).
- Be mindful of local election rules: North Dakota has no voter registration; Connecticut has no counties.

## Failure modes
| Symptom | Cause | Fix |
|---|---|---|
| Ran out of turns / timed out on a thin field | Over-searched past the 2-query cap hunting rosters to confirm or rule out a name | Honor the hard 2-search cap; if no opponent is confirmed and the seed is empty, emit `{ "opponents": [] }` and stop |
| A Bash command hangs ~30s then fails | A direct network call (`curl`/`requests`/`urllib`) - the container has no egress | Never make direct network calls; `WebSearch` is the only outside-world tool, and you do not verify URLs at all |
| A web-surfaced "candidate" isn't really in this race | Wrong district, past cycle, or withdrew | Confirm office + jurisdiction + date on an authoritative roster before adding; otherwise drop |
| A seed opponent looks like test/junk data | Non-production rows leaked into the roster | Drop obvious test rows; do not publish them |
| `No artifact files found in /workspace/output` | Never wrote the file | Write `/workspace/scratch/opponents.json`, run `assemble.py`, confirm `/workspace/output/opposition_research.json` exists |
