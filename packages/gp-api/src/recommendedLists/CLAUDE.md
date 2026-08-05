# src/recommendedLists/ — Recommended door-knocking lists (backend)

Turns a Win campaign's race into candidate-facing **door lists**: an anchor
turnout band, per-issue persuasion universes, a partisan-independence card, and a
GOTV drop-off estimate. Pro + `recommended-lists` flag gated. The heavy math runs
async against the Win voter mart and is cached in a snapshot; the GET endpoint is a
read model over that snapshot.

## Shape

| File | Role |
|------|------|
| `recommendedLists.controller.ts` | `GET campaigns/mine/recommended-lists`. HTTP only; Pro/flag gate + response validation live in the service. |
| `services/recommendedLists.service.ts` | Read model + scheduler. Pro/flag gate, snapshot lifecycle (pending/ready/failed), TTL re-enqueue, race-change reset. The GET path *is* the scheduler — a lost enqueue self-heals off the 15-min TTL, so enqueue failures are swallowed. |
| `services/recommendedListsCompute.service.ts` | The queue handler. Idempotent, stale-guarded, **never throws** (a throw = infinite SQS redelivery). Gathers context, runs the pure SQL builders against the Win warehouse, assembles + persists the payload. |
| `services/recommendedListsRules.util.ts` · `recommendedListsQueries.ts` | Pure engine: thresholds/predicates and exact Databricks SQL. Ported verbatim from the deterministic Python engine so parity checks stay byte-identical. Don't reimplement — call these. |
| `services/recommendedListsRegistry.ts` | `RECOMMENDED_LISTS_REGISTRY` — the per-variant static metadata (goal, priority, isActive, allowed outreach types, allowed phases, fixed name). The seed of the config-driven model; the extension point for adding a list. |
| `recommendedLists.constants.ts` | `RECOMMENDED_LISTS_DATABRICKS` DI token. |

## Envelope model (config-driven direction)

The `ready` payload is `{ meta, lists }`, where `lists` is an **ordered array of
envelopes** rather than bespoke `anchor` / `issueCards` / `partisan` / `gotv`
keys. Each envelope wraps a list in metadata:

```
{ variant, goal, name, priority, allowedOutreachTypes[], allowedPhases[], details }
```

`variant` discriminates the typed `details` (`voterSupportId` → anchor,
`persuasionIssueAligned` → issue card, `persuasionPartisanAligned` → partisan,
`gotv` → gotv); `goal` is the coarser product-facing category (both persuasion
variants share `persuasion`). The static metadata (`goal`, `priority`,
`isActive`, `allowedOutreachTypes`, `allowedPhases`, and the fixed `name` for
all variants but `persuasionIssueAligned`) lives in
`RECOMMENDED_LISTS_REGISTRY`; the compute service reads it when assembling
envelopes, skips a variant whose `isActive` is false, emits the contract's flat
`priority` from the entry's `priority.default`, sorts by it, and computes the
`persuasionIssueAligned` name per card (direction-aware: `high` → "Voters who
lean toward …", `low` → "… away from …"). The registry's `copy`,
`geographyOrder`, `priority.byPhase`, and capacity maps
(`OUTREACH_CONTACTS_PER_HOUR`, `RECOMMENDED_LISTS_CAPACITY`) are declared but
not yet wired into assembly.
A `persuasionPartisanAligned` envelope is omitted when there's no persuasion
universe, and a `gotv` envelope is omitted when turnout drop-off doesn't apply
(its absence, not a null field, signals "not applicable").

**Add a list** = a registry entry in `recommendedListsRegistry.ts` + a details
schema and a new `RecommendedListEnvelopeSchema` member in
`@goodparty_org/contracts` + assembly of the envelope in the compute service.
The top-level response shape doesn't change.

## Aggregate-only posture (the load-bearing invariant)

**No voter rows ever leave Databricks.** Every query the compute service runs is a
`COUNT`/`SUM`/`GROUP BY` aggregate; the payload holds counts, band sizes, and turf
totals only. The provider is Win's own `sp_win_agent` warehouse credential
(`WIN_DATABRICKS_*`) against `mart_win_agents.win_agent_voters`, with an app-layer
allowlist (`WIN_AGENT_VOTER_DIMENSIONS`), forbidden-column rules, and a cell-size
floor (`CELL_SIZE_FLOOR`) below which an issue card is dropped. **A per-voter
canvass list (voter_key + addresses) is explicitly out of scope** for this module —
it would move PII out of the warehouse and needs a separate, governed export path.

## Numbers to trust carefully

- **`VOTESCORE` is a documented placeholder for the per-voter turnout probability
  `p_hat`.** It's a weighted count of recent general-election participation (the
  precinct-of-1 form of the LightGBM precinct model), not a calibrated probability.
  The plausible-turnout electorate ("List type 1") is `VOTESCORE >= s*`, where `s*`
  is the score whose tie-inclusive cumulative count first covers projected turnout.
  Swap in the real modeled probability when it lands.
- **`DOOR_RATIO_FALLBACK` (0.62) is a fallback, not a measurement.** The win mart
  has no street addresses, so household density (voters→doors) can't be computed
  live. 0.62 is a national voters-per-household stand-in; `doorCount =
  round(voterCount * 0.62)`, `estimatedHours = doorCount / DOORS_PER_HOUR`. Source a
  real distinct-household count from people-api before treating door counts as firm.
- **Multi-seat races overstate the win number.** `votesNeeded` comes straight from
  election-api's `win_number_effective`, which assumes a single seat. For an
  at-large / multi-seat body the real threshold is lower, so the anchor band is
  conservative (too large) there. Don't present it as exact for multi-seat offices.

## Partisan card semantics (scope mixing — read before trusting the counts)

The partisan card carries two different scopes, and they don't add up the way
they look like they should:

- **`signals.*` and `listCount` are banded** — intersected with the
  plausible-turnout electorate (∩ the plausible-turnout electorate,
  `VOTESCORE >= s*`). `listCount` is the banded union: `signals` union ∩ that
  electorate, and it's the recommended door list size.
- **`districtWideUnionCount` is raw** — the union of the independence signals
  across the *whole district*, NOT intersected with the plausible-turnout
  electorate.

Subadditivity therefore holds only **within one scope**:
`listCount <= sum(signals)`, but `districtWideUnionCount` may **exceed**
`sum(signals)` because it's district-wide, not banded. `districtWideUnionCount >
sum(signals)` is correct engine behavior, not a bug — the field is named for its
scope precisely so the two aren't misread as one.

## Lifecycle notes

- One snapshot per campaign (`@@unique(campaignId)`), typed payload
  (`RecommendedListsPayload` = the contracts `RecommendedLists`).
- `raceId` on the snapshot is the guard: the compute handler ack-drops a recompute
  whose `raceId` no longer matches (the campaign's race changed under it), and the
  read model resets any snapshot whose `raceId` drifted from `campaign.details.raceId`.
- Databricks unconfigured (no `WIN_DATABRICKS_*`) ⇒ the provider factory returns
  null ⇒ the endpoint reports `unavailable` rather than queuing a recompute that
  can't run.
