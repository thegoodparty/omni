-- People-query perf benchmark — CASE 2: rare-pattern name search (trigram).
--
-- Mirrors the trigram-fenced name-search plan that VoterQueryService now
-- always uses (src/peopleDb/services/voterQuery.service.ts). A rare LIKE
-- pattern like '%zzq%' matches almost nothing, but Postgres floors LIKE
-- selectivity at ~2000 rows, so an ORDERED query walks the id ordering index
-- across the whole FL partition (30s+). Wrapping the match in a MATERIALIZED
-- CTE is an optimizer fence: the inner trigram scan resolves FIRST, off the
-- pg_trgm GIN indexes (Voter_firstname_lower_trgm_idx /
-- Voter_lastname_lower_trgm_idx on lower(col)), THEN the outer ORDER BY runs
-- over the tiny materialized result. Expected plan: Bitmap Index Scan on the
-- trgm indexes, NOT a Seq Scan / index walk. Target: sub-second.
--
-- lower(col) LIKE ... must match the GIN index expression exactly, and LIKE
-- metacharacters in the token are escaped, exactly as buildVoterWhereSql does.
WITH matches AS MATERIALIZED (
  SELECT v."id", v."FirstName", v."LastName"
  FROM "green"."Voter" v
  WHERE v."State" = 'FL'::"public"."USState"
    AND (
      lower(v."FirstName") LIKE '%zzq%' ESCAPE '\'
      OR lower(v."LastName") LIKE '%zzq%' ESCAPE '\'
    )
  LIMIT 10000
)
SELECT "id", "FirstName", "LastName"
FROM matches
ORDER BY "id"
LIMIT 20 OFFSET 0
