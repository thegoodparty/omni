# Opponent Actions

Turn a campaign's persisted opponent summaries plus the candidate's own platform
into up to 5 "stand out" action cards: each card names one issue where the
candidate and an opponent diverge, a short body grounded in district Haystaq
sentiment when the district has coverage, and a preset SMS message the candidate
could send as-is. Two signals combine: the summaries + platform supply every fact
the copy may state, and the district's Haystaq scores (Databricks) supply the only
numbers the copy may cite. Degrades gracefully to numberless cards when the
district is unknown or Haystaq has no coverage.

## BEFORE YOU START

1. Read this entire instruction end-to-end before executing anything.
2. Maintain a TodoWrite list mirroring the TODO CHECKLIST below.
3. Your params are in the `PARAMS_JSON` env var. Read them once at the top.
4. Write the final artifact to `/workspace/output/race_opponent_actions.json` and nowhere else.
5. Run `python3 /workspace/validate_output.py` before declaring success.
6. Perform the spot-check at the bottom — validator-passing data can still be garbage.

## TODO CHECKLIST

1. Read `PARAMS_JSON`: `opponents[]`, `candidate_platform`, the district params (`state`, `l2_district_type`, `l2_district_name`), `race_context` (Step 1).
2. Pick up to 5 distinct contrast angles from the summaries + platform (Step 2).
3. When the district params are present, map each angle to one `hs_*` column from the inline catalog (Step 3).
4. When the district params are present, run the district sentiment block: L2 value discovery, distribution check, ONE batched threshold query with coverage (Step 4).
5. Write the cards in threat order, assemble the artifact with `haystaq_status`, and write it (Step 5).
6. Run the mechanical constraint check (Step 6).
7. Validate (Step 7) and spot-check (Spot-check).

## CRITICAL RULES

**Facts and copy (the hard rules — these are what make the cards publishable):**

- **Work ONLY from the provided text plus the Haystaq numbers you actually queried.** Every claim about an opponent traces to that opponent's own `overview_text` / `background_text` / `issues_that_matter`; every claim about the candidate traces to `candidate_platform`. Nothing from general knowledge. There is NO web access here — no `WebSearch`, no `pmf_runtime.http`. Do not write code or shell that reaches the network.
- **Up to 5 cards, never padded.** Fewer when the field or the platform supports fewer distinct angles. A thin or absent `candidate_platform` means fewer cards, not invented planks.
- **`title` is at most 99 characters**, action-framed and naming the opponent and issue (e.g. "Stand out against Jeff Groh on housing affordability").
- **`body` is at most 3 sentences**, citing the district Haystaq percentages when coverage exists and stating that voters care about (or how they lean on) the issue. When coverage is missing, the body simply carries no statistic — never a made-up or borrowed one.
- **`sms_message` is at most 320 characters**: plain, factual, first-person candidate voice, a contrast message the candidate could send as-is. No placeholders to fill in, no links required, no hype. Only facts present in the input summaries and platform.
- **Every card is distinct**: at most one card per opponent+issue pair, no repeated facts, and no statistic repeated across cards. `opponent_name` echoes an input opponent verbatim; it may be null ONLY for an issue-ownership card the field's text supports without naming one opponent.
- **No family, health, or private life. No rumor.** Contrast on record and issues, never character.
- **No adjective inflation and no motive-guessing** ("out of touch", "doesn't care", "only in it for..."). Sub-50 shares are leans away — state them as what they are, never dress a 39.7% up as a majority.
- **No em dash (U+2014) anywhere in the output.**
- **Never apologize to the voter about missing data.** A numberless card makes the contrast without numbers; only `haystaq_status` records the gap.

**Databricks (`pmf_runtime.databricks`) — district sentiment only. When `l2_district_type` / `l2_district_name` are absent from PARAMS, SKIP Databricks entirely (no queries at all) and set `haystaq_status: "no_district"`:**

- **Connection API** (don't introspect — paste this verbatim):

  ```python
  from pmf_runtime import databricks as sql
  conn = sql.connect()
  cur = conn.cursor()
  cur.execute("SELECT ... WHERE col = :foo", {"foo": value})
  rows = cur.fetchall()
  ```

  The module is `pmf_runtime.databricks`. It exports `connect()`, `Connection`, `Cursor`, `ScopeViolation`, `UpstreamError`. There is no `databricks.query()` shortcut — you must `connect() → cursor() → execute() → fetchall()`. Skipping this step costs 3+ turns to discover via `dir()`.

- A query can return `state=PENDING` with no fetch-by-id (async). If so, just re-run the same statement.
- The broker auto-injects `WHERE Residence_Addresses_State = '<state>'` AND `Residence_Addresses_City IN (<cities>)` into every query. **DO NOT add these clauses yourself.** Adding them returns HTTP 422 `ScopeViolation: scope_predicate_override`. The only WHERE clauses your query needs are the L2 district column and `Voters_Active = 'A'`.
- **Scope by the L2 district column, NOT the mailing city.** The broker's injected city predicate matches mailing addresses (mostly outside the district); the backtick-quoted L2 district column is the actual electorate (e.g. in Hendersonville NC the mailing city matches 46,071 active voters while `` `City` = 'HENDERSONVILLE CITY' `` matches 9,449). If `total_active` looks like the whole metro area, your district clause did not hit.
- **The L2 district column name is the VALUE of `PARAMS.l2_district_type`** (e.g. `City`, `City_Ward`). The value to match is `PARAMS.l2_district_name`. Backtick-quote the column: `` `City` = 'HENDERSONVILLE CITY' ``.
- **`Voters_Active` is a STRING.** Use `Voters_Active = 'A'`. `Voters_Active = 1` matches zero rows.
- **All `hs_*` columns are CONTINUOUS 0-100 SCORES** regardless of suffix (`_yes`, `_no`, `_treat`, `_oppose`, `_support`, `_fund_more`, `_pro_choice`, `_believer`, `_worried`, `_increase`, etc.). Threshold with `>= 50` (leans) or `>= 70` (leans strongly). Using `= 1` because the name "looks binary" inverts your rankings — you will get all counts at <5%. Exception: if the Step 4 distribution check shows `max <= 1` for a column, that column really is binary — use `= 1` for that column only.
- **Scores are within-state percentile ranks (mean ~50).** A district where ~50% clear the `>= 50` threshold is at the state average; the informative signal is the deviation from 50% (61.8% is a real lean toward, 39.7% a real lean away). Prefer card angles where the share deviates meaningfully from 50%.
- **Conditional counts use `SUM(CASE WHEN ... THEN 1 ELSE 0 END)`.** Postgres `COUNT(*) FILTER (WHERE ...)` is a syntax error in Databricks.
- **`CAST(col AS DOUBLE)`** before comparing or averaging `hs_*` columns.
- **Use named placeholders** when parameterizing: `cursor.execute("... WHERE col = :foo", {"foo": value})`. Positional `?` raises a SQL error.
- **Named placeholders bind VALUES, not IDENTIFIERS.** Column names must be string-interpolated (f-string). Whitelist-validate any identifier before interpolating: `assert col in ALLOWED_COLS`.
- **Every query must reference an allowed table.** Bare `SELECT 1` (no FROM) is rejected.
- **`GROUP BY` queries are silently truncated at the row cap** with no truncation signal. Always add `ORDER BY count DESC LIMIT N` to GROUP BY queries so the truncation is deterministic.
- **Do NOT query `information_schema.columns` or `SHOW COLUMNS`** — the broker blocks them (`ScopeViolation: disallowed_table` / `disallowed_verb`), and probing burns turns. Use the **inline Haystaq catalog** below for column names; it is the complete, L2-verified set for this experiment. `ALLOWED_COLS` (Step 4) is exactly the columns listed there.
- **Coverage rule + cell-size floor.** In the batched query also select `COUNT(col)` per column. Drop any column whose coverage is below ~80% of `total_active` (whole Haystaq models are missing per state). Also treat the result as no-coverage when `total_active < 50` or a per-column `>= 50` count is under ~25 voters: below that floor the percentage is noise. No coverage never kills the card; it removes its numbers.
- **Never substitute an adjacent column to get a number.** If the direct column for the card's issue has no coverage, the card goes out numberless; do not quietly cite a related-sounding column instead.

### Inline Haystaq catalog (L2-verified)

This is the **complete** column set available to this experiment — do not query a
dictionary/metadata table at runtime. Columns are continuous 0-100 within-state
percentile ranks (see the score rule above); the entry names encode direction.
Grouped into 9 topics:

**housing** — `hs_affordable_housing_gov_has_role` (gov has a role in affordable housing), `hs_affordable_housing_gov_no_role` (opposes gov role), `hs_gentrification_support`, `hs_gentrification_oppose`, `hs_new_home_buyer`, `hs_any_home_buyer`

**taxes** — `hs_tax_cuts_support`, `hs_tax_cuts_oppose`, `hs_gas_tax_support`, `hs_gas_tax_oppose`, `hs_social_security_tax_increase_support`, `hs_social_security_tax_increase_oppose`, `hs_min_wage_15_increase_support`, `hs_min_wage_15_increase_oppose`, `hs_ideology_fiscal_conserv`, `hs_ideology_fiscal_liberal`

**education** — `hs_school_choice_support`, `hs_school_choice_oppose`, `hs_school_funding_more`, `hs_school_funding_less`, `hs_charter_schools_support`, `hs_charter_schools_oppose`, `hs_teachers_union_positive`, `hs_teachers_union_negative`, `hs_community_college_free_support`, `hs_community_college_free_oppose`

**healthcare** — `hs_medicaid_expansion_support`, `hs_medicaid_expansion_oppose`, `hs_medicare_for_all_support`, `hs_medicare_for_all_oppose`, `hs_obamacare_aca_expand`, `hs_obamacare_aca_protect`, `hs_obamacare_aca_oppose`, `hs_family_medical_leave_support`, `hs_family_medical_leave_oppose`, `hs_opioid_crisis_treat`, `hs_opioid_crisis_enforce`

**climate_energy** — `hs_climate_change_believer`, `hs_climate_change_nonbeliever`, `hs_electric_vehicle_likely_buyer`, `hs_electric_vehicle_not_likely`, `hs_solar_panel_buyer_yes`, `hs_solar_panel_buyer_no`, `hs_pipeline_fracking_support`, `hs_pipeline_fracking_oppose`, `hs_green_new_deal_support`, `hs_green_new_deal_oppose`, `hs_sell_federal_lands_support`, `hs_sell_federal_lands_oppose`

**immigration** — `hs_mass_deporations_support`, `hs_mass_deporations_oppose`, `hs_mexican_wall_support`, `hs_mexican_wall_oppose`, `hs_immigration_process_unfair`, `hs_immigration_undesirable`

**crime_safety** — `hs_violent_crime_very_worried`, `hs_violent_crime_not_worried`, `hs_gun_control_support`, `hs_gun_control_oppose`, `hs_police_trust_yes`, `hs_police_trust_no`, `hs_death_penalty_support`, `hs_death_penalty_oppose`

**social_issues** — `hs_abortion_pro_choice`, `hs_abortion_pro_life`, `hs_same_sex_marriage_support`, `hs_same_sex_marriage_oppose`, `hs_trans_athlete_yes`, `hs_trans_athlete_no`, `hs_dei_support`, `hs_dei_oppose`, `hs_religion_important`, `hs_religion_not_important`

**regulation_economy** — `hs_regulations_too_harsh`, `hs_regulations_good`, `hs_capitalism_believe_sound`, `hs_capitalism_believe_flawed`, `hs_unions_beneficial`, `hs_unions_not_beneficial`, `hs_income_inequality_serious`, `hs_income_inequality_no_issue`, `hs_infrastructure_funding_fund_more`, `hs_infrastructure_funding_enough_spent`

Note: coverage varies by state — some columns return near-zero `cov_*` and are
dropped by the Step 4 coverage rule (informative, not a gap).

**Output:**

- Write **only** to `/workspace/output/race_opponent_actions.json`. The runner publishes nothing else.
- Run `python3 /workspace/validate_output.py` before declaring success. The runner-level validator rejects the artifact post-hoc if you skip this; in-loop validation lets you fix violations cheaply.

## Steps

### Step 1 — read params

```python
from pmf_runtime import milestone; milestone("read params")
```

```python
import json, os
PARAMS = json.loads(os.environ["PARAMS_JSON"])
OPPONENTS = PARAMS["opponents"]
PLATFORM = PARAMS.get("candidate_platform") or {}
L2_TYPE = PARAMS.get("l2_district_type")  # L2 column name, e.g. "City"
L2_NAME = PARAMS.get("l2_district_name")  # value to match, e.g. "HENDERSONVILLE CITY"
HAS_DISTRICT = bool(L2_TYPE and L2_NAME)  # False => degrade path: skip Steps 3-4 entirely
RACE = PARAMS.get("race_context") or {}
print("candidate issues:", [i.get("title") for i in (PLATFORM.get("issues") or [])])
for o in OPPONENTS:
    print(o["opponent_name"], o["threat_tier"], "issues:", o.get("issues_that_matter"))
print("district:", PARAMS.get("state"), L2_TYPE, L2_NAME)
```

If `HAS_DISTRICT` is `False`, skip Steps 3-4 entirely: every card is written from
the summaries and platform alone, and `haystaq_status` is `"no_district"`.

### Step 2 — pick contrast angles

```python
from pmf_runtime import milestone; milestone("pick contrast angles")
```

Compare `candidate_platform.issues` against each opponent's `issues_that_matter`,
`overview_text`, and `background_text`. A usable angle is an opponent weakness ×
candidate strength × issue, in one of two forms:

- **The opponent is silent** on one of the candidate's planks (their summary text never raises it), or
- **The opponent's stated stance cuts against** the candidate's plank (their summary says so in as many words).

Weight angles against the `primary_threat` opponent first, then `watch_closely`,
then `low_priority`; spread cards across opponents and issues so no two cards
repeat an opponent+issue pair. An issue-ownership angle the field's text supports
without naming one opponent (e.g. no opponent in the whole field addresses the
plank) may carry `opponent_name: null` — at most one such card. Every angle must
trace to text actually present in the inputs. If the platform is thin or absent,
fewer cards — never padded or repeated ones. Pick up to 5 angles.

### Step 3 — map angles to hs_* columns

```python
from pmf_runtime import milestone; milestone("map angles to columns")
```

Skip when `HAS_DISTRICT` is `False`. For each angle, pick the ONE column from the
inline Haystaq catalog above that most directly measures sentiment on that
angle's issue (e.g. housing plank -> `hs_affordable_housing_gov_has_role`,
roads/water plank -> `hs_infrastructure_funding_fund_more`, tax-cut contrast ->
`hs_tax_cuts_support`). An angle with no matching column just becomes a
numberless card — do not stretch a related-sounding column onto it.

### Step 4 — district sentiment (ONE python block)

```python
from pmf_runtime import milestone; milestone("district sentiment")
```

Skip when `HAS_DISTRICT` is `False`. **Run this ENTIRE step as ONE python block (the
block below is complete — value discovery, distribution check, batched threshold
query, and a compact printout). Target 1-2 turns.** If the block fails twice
end-to-end, set `haystaq_status: "no_coverage"` and write every card numberless —
do not spend more turns debugging it.

```python
import re, time
from pmf_runtime import databricks as sql

TABLE = "goodparty_data_catalog.dbt.int__l2_nationwide_uniform_w_haystaq"
conn = sql.connect(); cur = conn.cursor()

def run(q, p):
    # a query can return state=PENDING (async, no fetch-by-id) — just re-run it
    for attempt in range(4):
        cur.execute(q, p)
        rows = cur.fetchall()
        if rows: return rows
        time.sleep(2)
    return []

ALLOWED_COLS = INLINE_HAYSTAQ_COLUMNS  # the set of column names in the catalog above
cols = [...]  # the Step 3 columns, one per angle that found a match
assert cols, "no angle matched a catalog column — skip this step, haystaq_status: no_coverage"
assert all(re.fullmatch(r"hs_[a-z0-9_]{1,60}", c) for c in cols)
assert all(c in ALLOWED_COLS for c in cols)

# Discover the exact L2 district value. PARAMS may pass L2_NAME='25' while the
# L2 value is 'NEW YORK CITY CNCL DIST 25 (EST.)'.
assert re.fullmatch(r"[A-Za-z][A-Za-z0-9_]{0,63}", L2_TYPE)  # ASCII identifier
rows = run(f"""
  SELECT DISTINCT `{L2_TYPE}` AS district_value, COUNT(*) AS n
  FROM {TABLE} WHERE Voters_Active = 'A'
  GROUP BY `{L2_TYPE}` ORDER BY n DESC LIMIT 200
""", {})
district_value = next((r[0] for r in rows if r[0] == L2_NAME), None) or next(
    (r[0] for r in rows if L2_NAME and L2_NAME.lower() in str(r[0]).lower()), None
)

if district_value is None:
    print("NO L2 MATCH — haystaq_status: no_coverage, all cards numberless")
else:
    # Distribution check (do not skip): confirm 0-100 continuous per column.
    dist_sql = ", ".join(
        f"MIN(CAST(`{c}` AS DOUBLE)) AS `min_{c}`, MAX(CAST(`{c}` AS DOUBLE)) AS `max_{c}`"
        for c in cols
    )
    drow = run(f"""
      SELECT {dist_sql} FROM {TABLE}
      WHERE `{L2_TYPE}` = :l2_name AND Voters_Active = 'A'
    """, {"l2_name": district_value})[0]
    binary = {c for i, c in enumerate(cols)
              if drow[2*i + 1] is not None and drow[2*i + 1] <= 1}

    # ONE batched threshold query: both thresholds + per-column coverage.
    def th(c, t):
        return (f"CAST(`{c}` AS DOUBLE) = 1" if c in binary
                else f"CAST(`{c}` AS DOUBLE) >= {t}")
    aggs = ", ".join(
        f"SUM(CASE WHEN {th(c, 50)} THEN 1 ELSE 0 END) AS `{c}__ge50`, "
        f"SUM(CASE WHEN {th(c, 70)} THEN 1 ELSE 0 END) AS `{c}__ge70`, "
        f"COUNT(`{c}`) AS `{c}__cov`"
        for c in cols
    )
    row = run(f"""
      SELECT COUNT(*) AS total_active, {aggs} FROM {TABLE}
      WHERE `{L2_TYPE}` = :l2_name AND Voters_Active = 'A'
    """, {"l2_name": district_value})[0]

    total_active = row[0]
    stats = {}
    for i, c in enumerate(cols):
        ge50, ge70, cov = row[1 + 3*i], row[2 + 3*i], row[3 + 3*i]
        if (total_active >= 50 and cov and cov >= 0.8 * total_active
                and ge50 is not None and ge50 >= 25):
            stats[c] = {
                "total_active": total_active,
                "count_ge50": ge50, "pct_ge50": round(100.0 * ge50 / total_active, 1),
                "count_ge70": ge70, "pct_ge70": round(100.0 * ge70 / total_active, 1),
            }
    print({"district_value": district_value, "total_active": total_active,
           "binary_cols": sorted(binary), "stats": stats})
```

`total_active` should look like one district, not the whole metro or state — if
it is far larger than a plausible electorate for this office, the district clause
did not hit; treat it as no-coverage rather than citing mis-scoped numbers.
Columns absent from `stats` failed the coverage rule or cell-size floor: their
cards go out numberless.

### Step 5 — write the cards and the artifact

```python
from pmf_runtime import milestone; milestone("write cards")
```

For each angle, in threat order, write `title` / `body` / `sms_message` /
`opponent_name` / `issue` under the copy rules in CRITICAL RULES. The body's
factual spine is: (1) what the opponent's summary says (or is silent on), (2) the
district numbers when the column survived Step 4 (from `stats`, verbatim), and
(3) what the candidate's own plank commits to. The `sms_message` makes the same
contrast in the candidate's first-person voice, self-contained and sendable
as-is. A numberless body keeps the same spine with the statistic slot replaced by
grounded salience from the inputs (e.g. the issue is contested in the race) or by
the candidate's own commitment — never "many voters feel..." backed by nothing.

Set `haystaq_status`:

- `"no_district"` — the district params were absent and Databricks was skipped entirely.
- `"no_coverage"` — queries ran but no column survived (or the L2 value never matched, or the Step 4 block failed twice).
- `"district_scoped"` — at least one card cites surviving district numbers.

```python
import json, datetime
artifact = {
    "generated_at": datetime.datetime.now(datetime.timezone.utc)
        .isoformat(timespec="seconds").replace("+00:00", "Z"),
    "haystaq_status": "...",
    "actions": [...],  # card dicts in threat order, up to 5
}
json.dump(artifact, open("/workspace/output/race_opponent_actions.json", "w"), indent=2)
```

### Step 6 — mechanical constraint check

```python
from pmf_runtime import milestone; milestone("mechanical check")
```

```python
import json, re
out = json.load(open("/workspace/output/race_opponent_actions.json"))
seen_pairs, seen_numbers = set(), set()
for c in out["actions"]:
    assert len(c["title"]) <= 99
    assert len(c["sms_message"]) <= 320
    assert c["body"].rstrip().endswith((".", "!", "?"))
    assert len(re.findall(r"(?<![A-Z])[.!?](?:\s+[A-Z]|$)", c["body"])) <= 3
    assert "—" not in (
        c["title"] + c["body"] + c["sms_message"]
        + (c["opponent_name"] or "") + c["issue"]
    )
    pair = (c["opponent_name"], c["issue"])
    assert pair not in seen_pairs; seen_pairs.add(pair)
    for pct in re.findall(r"\d+(?:\.\d+)?%", c["body"] + " " + c["sms_message"]):
        assert pct not in seen_numbers, f"statistic {pct} repeated across cards"
        seen_numbers.add(pct)
print("ok:", len(out["actions"]), "cards,", out["haystaq_status"])
```

Fix any assertion failure by editing the offending card, not by rebuilding the set.

### Step 7 — validate

```python
from pmf_runtime import milestone; milestone("validate")
```

```bash
python3 /workspace/validate_output.py
```

Fix any schema error before declaring success.

## Spot-check

Validator-passing JSON can still be garbage. Before declaring success, confirm:

- **Every factual claim about an opponent traces to that opponent's own summary text; every claim about the candidate traces to `candidate_platform`.** Nothing from general knowledge.
- **Every cited percentage matches Step 4's `stats` output exactly; no percentage appears on a card whose column was dropped**, and no adjacent column was substituted to get a number.
- **No card contrasts on character, family, health, or motive.** Read each `sms_message` out loud: it should sound like a normal person stating facts.
- **Cards are genuinely distinct angles**, not the same contrast rephrased; no opponent+issue pair or statistic repeats.
- **Sub-50 shares are stated honestly as leans away**, never inflated ("overwhelmingly", "most voters") past what the number says.
- **`haystaq_status` matches reality**: `district_scoped` only when a card actually cites district numbers; `no_district` only when the district params were absent from PARAMS.
- **No em dash (U+2014) anywhere in the output, and no card apologizes for missing data.**

## Failure modes

| Symptom | Cause | Fix |
|---|---|---|
| All percentages near zero | Used `= 1` on `hs_*` columns because the suffix "looks binary" | They are 0-100 continuous; the Step 4 distribution check drives `= 1` only for true `max <= 1` columns |
| Every card's percentage hovers at ~50% | Forgot the scores are within-state percentile ranks | ~50% is the state baseline; pick angles where the share deviates from 50 |
| `ScopeViolation: scope_predicate_override` | Added `WHERE Residence_Addresses_State/City` manually | Remove those clauses; the broker auto-injects them |
| `ScopeViolation: disallowed_table` on column discovery | Queried `information_schema.columns` / `SHOW COLUMNS` | Use the inline Haystaq catalog; never query metadata tables |
| Syntax error on `COUNT(*) FILTER` | Postgres syntax, not Databricks | `SUM(CASE WHEN ... THEN 1 ELSE 0 END)` |
| `total_active` looks like the whole metro | The L2 value mismatched and only the injected city scope hit | Confirm the value via the `SELECT DISTINCT` discovery; no match means no-coverage, not mis-scoped numbers |
| Query returns 0 rows | `Voters_Active = 1`, or the L2 value doesn't match verbatim | `Voters_Active = 'A'` (string); re-check the discovery match |
| A card cites a number for a dropped column | Substituted an adjacent column | Direct column or nothing; the card goes out numberless |
| A card claims voters "overwhelmingly" want something at 39.7% | Adjective inflation over an away-lean | State the number as what it is; sub-50 shares are leans away |
| An SMS reads as an attack or guesses motive | Contrast drifted from record/issues to character | Rewrite: facts from the summaries and platform only |
| Two cards feel like the same card | Same contrast rephrased, or a statistic reused | One opponent+issue angle and one statistic per card |
| Output has cards but no numbers and no district | That is correct behavior | Degrade path: numberless cards, `haystaq_status: "no_district"` |
| A command hangs or fails reaching the network | This experiment has no web egress and needs none | Facts come from PARAMS; numbers come only from `pmf_runtime.databricks` |
