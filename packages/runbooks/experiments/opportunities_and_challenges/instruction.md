# Opportunities and Challenges

Produce the Opportunities and Challenges of a candidate's campaign plan: up to 3 structural advantages and up to 3 structural risks, each a finished 1-3 sentence bullet grounded in THIS race's numbers, with every external claim cited and every cited URL verified HTTP 200. Both lists are derived from the `campaign_strategy_context` handed to you in params (gp-api hydrated it from election-api before dispatch); the numbers carry most bullets, and light web search corroborates any external fact you cite. Output is structured JSON - there is no markdown section to render.

## BEFORE YOU START
1. Read this entire instruction end-to-end before executing anything.
2. Maintain a TodoWrite list mirroring the TODO CHECKLIST below.
3. Your params are in the JSON file named by the `PARAMS_FILE` env var. Read them once at the top.
4. Write the final artifact to `/workspace/output/opportunities_and_challenges.json` and nowhere else.
5. Run `python3 /workspace/validate_output.py` before declaring success.
6. Perform the spot-check at the bottom - validator-passing data can still be garbage.

## TODO CHECKLIST
1. Read params; identify the candidate (`is_user`) and read the race numbers + roster (Step 0).
2. Derive the opportunity signals and the challenge signals from the numbers (Step 1).
3. Corroborate any external claim with WebSearch and verify its URL with `http.head` (Step 2).
4. Write up to 3 opportunities and up to 3 challenges, each a bullet string with its citation inlined (Step 3).
5. Write the artifact JSON (Step 4).
6. Validate, then spot-check (Step 5).

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

**Network egress is quarantined.** The ONLY ways to reach the internet are `WebSearch` and the broker-proxied `pmf_runtime.http` helpers. `urllib`/`requests`/`httpx`/`curl`/`wget`/`socket` do NOT work - they hang ~30s+ then fail, torching the time budget. NEVER write code or shell that fetches a URL directly.

**Web-access ladder - use the cheapest rung; do NOT jump to the browser:**
1. `WebSearch` (free, fast) - discovery. Snippets usually answer the question; only fetch a page when you must confirm a claim against its body.
2. To VERIFY a URL is live before citing it, run exactly this in Bash:
   ```bash
   python3 -c "from pmf_runtime import http; print(http.head('<url>'))"
   ```
   It returns `{"status": int, "final_url": str}`. Cite a URL only if `status == 200`; on a redirect, cite the `final_url` unless the redirect only added tracking params.
3. `pmf_runtime.http.get(url)` (browser render) is a LAST RESORT - only when `head` returns 403/405 on a real site or you must read the page body.

**Opponent data is provisional - do NOT build bullets on it.** The roster in `campaign_strategy_context` (`candidate_count`, `candidates[]`, and each candidate's `is_incumbent`) is currently incomplete and lags reality; who is actually running is owned by a separate opposition-research process, not this one. Do NOT base any opportunity or challenge on the number of opponents, whether it is an open seat, or whether anyone is an incumbent, as read from this roster. Build every bullet from the reliable race numbers (`win_number_effective`, `projected_turnout`, `contacts_needed_estimate`, `registered_voters`, election dates, `number_of_seats`, `office_level`/`office_type`, `state`, `partisan_type`) and from web search. If you want to make a point about the field (open seat, crowded race, a strong incumbent), confirm it with a web search and cite that source - never assert it from the provided roster.

**`campaign_story` shapes selection and voice, not facts.** The candidate's `campaign_story` (why/background/issues) tells you WHICH opportunities/challenges matter to this candidate and how to frame them in their voice — lean toward signals that connect to the issues and background they care about. It is NOT a factual source: never present story content as an external claim, never cite it, and never build a bullet whose substance rests on it. Every bullet's facts still come from the reliable race numbers (cite `GoodParty.org Data`) or a 200-verified web source. Treat null/empty story fields as "no steer."

**Bullet-content rules (every opportunity and challenge string):**
- Plain, direct U.S. English. **No em dashes.** No jargon.
- 1-3 sentences. No section headers, list markers, or preamble inside the string - just the bullet's prose plus its inline citation `... ([source](url))`.
- Refer to the candidate as **"you"**, NEVER by name.
- Numbers, not words: "50% + 1" not "half"; "5 times the projected voter turnout" not "five times".
- Specific to THIS race and THESE numbers - never generic campaign advice.
- Cite every claim. Claims from the provided context cite `GoodParty.org Data`; external claims cite a source URL verified 200.
- Respect local election rules (e.g. North Dakota has no voter registration; Connecticut has no counties; California uses a top-two primary; Louisiana uses a jungle primary).

## Steps

### Step 0 - Read params, identify the candidate, read the numbers

Read `PARAMS_FILE` once. The candidate you write FOR is `user_full_name` (output says "you", never the name). Find the candidate's own row via `is_user`: match `user_email` to `campaign_strategy_context.candidates[].email` (case-insensitive + trimmed), falling back to a fuzzy `full_name` match (normalize case, strip middle initials / suffixes / accents). You do not list opponents here, but identifying the candidate keeps their name out of the bullets and lets you read the roster correctly. (`race_id` is a trace id - ignore it; you never call election-api.)

