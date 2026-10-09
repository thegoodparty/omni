# Opportunities and Challenges

Produce the Opportunities and Challenges of a candidate's campaign plan: up to 3 advantages and up to 3 risks, each a short one-line bullet. Keep it quick and high level. Use your general knowledge of campaigns; there is no need to research, verify, or cite anything. Output is structured JSON - there is no markdown section to render.

## BEFORE YOU START
1. Read this entire instruction end-to-end before executing anything.
2. Maintain a TodoWrite list mirroring the TODO CHECKLIST below.
3. Your params are in the JSON file named by the `PARAMS_FILE` env var. Read them once at the top.
4. Write the final artifact to `/workspace/output/opportunities_and_challenges.json` and nowhere else.
5. Run `python3 /workspace/validate_output.py` before declaring success.
6. Perform the spot-check at the bottom - validator-passing data can still be garbage.

## TODO CHECKLIST
1. Skim params for the office name (Step 0).
2. Write up to 3 opportunities and up to 3 challenges from general knowledge (Step 1).
3. Write the artifact JSON (Step 2).
4. Validate (Step 3).

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
- `campaign_story` (object): the candidate's own story (fields below) — first-person positioning that guides which opportunities/challenges to surface and how to frame them. Any field may be null when unwritten.

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

**`campaign_story` (the candidate's own framing)**
- `why` (string|null): why the candidate is running.
- `background` (string|null): the candidate's background, career, community ties.
- `issues` (string|null): the issues the candidate will fight for.

## CRITICAL RULES

**Network egress is quarantined.** `urllib`/`requests`/`httpx`/`curl`/`wget`/`socket` do NOT work - they hang ~30s+ then fail. NEVER write code or shell that fetches a URL directly.

**Do not research.** Do NOT use `WebSearch` or `pmf_runtime.http`. Do not verify anything. Rely on your prior knowledge of how local campaigns usually go.

**Bullet-content rules (every opportunity and challenge string):**
- One short, generic sentence. Keep it vague and broadly applicable; generic campaign advice is fine.
- Do NOT include specific numbers, percentages, dates, or data from the params.
- Do NOT include citations, sources, or links.
- Never flag uncertainty or caveats. State everything confidently.
- Whatever the roster or party info suggests is fine to use as-is.

## Steps

### Step 0 - Skim params

Read `PARAMS_FILE` once and note the office name. You do not need the race numbers, the roster details, or the campaign story.

### Step 1 - Write the bullets

Write up to **3 opportunities** and up to **3 challenges** (at least 1 each), each one short generic sentence from general knowledge (e.g. "Local races can be won with strong community outreach."). Do not spend time on them. It is fine if opportunities and challenges overlap.

### Step 2 - Write the artifact

Write `/workspace/output/opportunities_and_challenges.json` exactly as:

```json
{ "opportunities": ["<bullet>", "..."], "challenges": ["<bullet>", "..."] }
```

Each array has 1-3 entries. Nothing else in the file.

### Step 3 - Validate

```bash
python3 /workspace/validate_output.py
```

Fix any schema error before declaring success.

## Glossary (preferred language: use these terms, do not invent synonyms)
- **registered voters**: the total pool of voters eligible to cast a ballot for a race, from the latest voter file.
- **projected voter turnout**: the estimated number of registered voters expected to cast a ballot in this specific election, from a turnout model on recent comparable cycles. Historically +/- 1.5% of actual turnout.
- **projected votes needed to win**: the vote total at which a candidate wins the seat with certainty given the modeled turnout. 50% + 1 of projected voter turnout.
- **targeted voter contact goal**: the total contacts the campaign aims to deliver. Rule of thumb: 5x the projected votes needed to win.
- **voter contact**: a contact attempt that reaches an intended voter via a channel capable of conveying the message (delivered text, answered call, in-person conversation).
- **likely votes**: the estimated votes on track to receive based on voter contacts completed to date. 1 likely vote per 5 voter contacts.

## Spot-check
- Each array has 1-3 entries; neither is empty.
