-- pg_trgm enables trigram GIN indexes so leading-wildcard name search
-- (lower(...) LIKE '%tok%') can use an index instead of scanning Voter
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Trigram indexes for substring matching on names; expressions must stay
-- lower("FirstName") / lower("LastName") exactly to match the query shape
CREATE INDEX CONCURRENTLY IF NOT EXISTS "Voter_firstname_lower_trgm_idx" ON "Voter" USING GIN (lower("FirstName") gin_trgm_ops);
CREATE INDEX CONCURRENTLY IF NOT EXISTS "Voter_lastname_lower_trgm_idx" ON "Voter" USING GIN (lower("LastName") gin_trgm_ops);
