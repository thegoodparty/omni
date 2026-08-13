-- People-query perf benchmark — CASE 1: statewide filtered COUNT.
--
-- Mirrors the honest query that VoterQueryService.rawCountForDistrict
-- (src/peopleDb/services/voterQuery.service.ts) emits for a statewide
-- audience with a phone predicate and no district join — the query class
-- behind GET /voters/voter-file?countOnly=true (type=sms -> cell,
-- type=robocall -> landline). This is a full ~15M-row FL partition scan
-- with non-indexed IS NOT NULL predicates (Seq Scan is EXPECTED here — the
-- point of the benchmark is that this honest count is ~3.2-3.4s, the number
-- the removed 10k "fence" floor used to hide).
--
-- FL is inlined as a literal (never bound) exactly as stateEquals() does it,
-- so the planner keeps constant-propagation across the partition. See the
-- comment on stateEquals in buildVoterWhereSql.util.ts.
SELECT COUNT(*)::bigint AS voter_count
FROM "green"."Voter" v
WHERE v."State" = 'FL'::"public"."USState"
  AND v."VoterTelephones_CellPhoneFormatted" IS NOT NULL
  AND v."VoterTelephones_LandlineFormatted" IS NOT NULL
