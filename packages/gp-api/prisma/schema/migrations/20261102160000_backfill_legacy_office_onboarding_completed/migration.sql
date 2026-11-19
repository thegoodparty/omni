-- Scheduled Serve jobs now run only for offices with onboarding_completed_at
-- set. Offices created before the column existed (20260612160000) never had
-- a way to set it, so they count as finished. Anything newer stays unset
-- until its holder completes Serve onboarding.
UPDATE "elected_office"
SET "onboarding_completed_at" = "created_at"
WHERE "onboarding_completed_at" IS NULL
  AND "created_at" < '2026-06-12';
