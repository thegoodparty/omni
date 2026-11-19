# Flows: read path and vocabularies

<!-- Moved verbatim from contacts/AGENTS.md so the auto-loaded AGENTS.md stays small. Edit here. -->

### Read path (list, typeahead, detail, count, download)

webapp → `GET /v1/contacts` → `ContactsService.findContacts` → resolve
filters (`convertVoterFileFilterToFilters` in
`utils/voterFileFilter.utils.ts` + activity/support resolution below) →
`VoterQueryService.findPeople` → join/strip (party choke point
`stripWinOnlyFieldsIfElectedOffice`) → respond. Typeahead is the same endpoint
with a small page; person detail adds derived `supportStatus` and
`optedOutAt` (`ContactInteractionTextService.latestOptOutAt`). The count
endpoint runs the identical translation with `resultsPerPage: 1` and
returns `{ count }`. A voter read that exceeds the warehouse's timeout fails
loudly as a `GatewayTimeoutException` (504) rather than degrading into a
floored or partial count — see `src/peopleDb/CLAUDE.md`.

A `segment` is either a built-in name (`segmentsToFiltersMap.const.ts`), Serve's
`civicPanel` (`CIVIC_PANEL_SEGMENT` in contracts: resolved as a saved list holding
only `civicPanelMember`, so the same 400 for a non-`eo-` org and the same empty
result for an empty panel), or a `VoterFileFilter` id this org owns. Anything else — malformed, deleted,
cross-org — is a **404** (`resolveCustomSegment`), never "no filter". Widening
an unresolvable segment to the whole district is the most expensive possible
default: it served, and let `GET /v1/contacts/download` stream, every voter in
the district with a 200.

### Activity-condition + support-status resolution

`ActivityConditionResolutionService` (contactInteraction) resolves each
condition to a `personId` set with plain SQL over the channel's
`contact_interaction_*` table (scoped to `outreachId` when named,
restricted to selected outcomes when `actions` is non-empty); sets
AND-compose. `SupportStatusService` resolves the support buckets the same
way. Both travel to the voter engine as `id: { in | notIn }` on the Voter
PK — a `::uuid[]` SQL builder in `src/peopleDb`'s filter pipeline
(`filters.schema.ts` → `transformFilters` → `buildVoterFiltersSql`),
**capped at 200k ids** (400 beyond; the trigger to revisit the projection
fallback). A condition naming a specific `outreachId` only accepts
**completed** outreaches.

### The Voter_Status propensity vocabulary

`Voter_Status` is a turnout-propensity bucket for the 2026 General, derived
from the in-house model probability: `Unlikely` (<0.25), `Unreliable` (<0.50),
`Likely` (<0.75), `Super` (>=0.75), `Unknown` (no score). All five are real,
populated values. A selection that includes `Unknown` also matches a NULL
`Voter_Status` (`buildVoterFiltersSql`), which every consumer-only row of
`gp_api_constituents` carries; the door-knocking pack shades NULL as
`Unknown` too.

This replaced an older participation-count CASE on 2026-07-31 (gp-data-platform
#725 / DATA-2209), which reached production on 2026-08-04. The old vocabulary
had a `First Time` value and no `Unreliable`; both facts are now false, and
the `expandUnreliableVoterStatus` workaround that compensated for them has
been removed. `First Time` matches zero rows and is no longer offered
anywhere.

The model is scoped to a specific election cycle and will be re-cut. If
`Voter_Status` stops matching the five values above, every likelihood filter in
the product is silently wrong — check the live vocabulary against the
`mart_gp_api` voter mart in Databricks before trusting any filter-related bug
report.

### The Early_Vote_Status vocabulary

`Early_Vote_Status` is the likelihood of voting before Election Day, early in
person or by mail: the higher of Haystaq's `hs_likely_ev` and `hs_likely_vbm`
(0-100), bucketed `Very unlikely` (<25), `Unlikely` (<55), `Likely` (<80),
`Very likely` (>=80), `Unknown` (no score), in the mart's sentence case.
The product speaks Title Case (`Very Likely`, `Very Unlikely`) like its other
multi-word person values; `peopleDb/earlyVoteStatus.ts` translates both ways,
for the Person payload and for filter values going into SQL. The CSV copies
the column raw, so it still says `Very likely`. Both scores are within-state
percentiles, so the buckets are relative to the state, not probabilities; the
max skews high, which is why the cuts sit above `Voter_Status`'s. It reaches the
filter as the `earlyVote*` booleans → `earlyVoteStatus`, with the same
`Unknown`-also-matches-NULL rule as `voterStatus`, but none of the
per-person override handling below: there is no editable early-vote status.
It is Win-only everywhere: hidden in the UI and dropped from Serve downloads
like Voter Likelihood, and also `modes: 'win'` in the filter catalog, which
Voter Likelihood (`audience`) is not, so the assistant never offers it to an
`eo-` org.
