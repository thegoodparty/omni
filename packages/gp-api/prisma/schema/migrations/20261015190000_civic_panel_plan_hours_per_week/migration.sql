-- The plan asks for the official's weekly time instead of monthly hours.
-- Additive: hours_per_month stays (nullable) until a follow-up drops it, so
-- code still reading it keeps working while this deploys.
ALTER TABLE "civic_panel_build_plan" ADD COLUMN "hours_per_week" INTEGER NOT NULL DEFAULT 1;

UPDATE "civic_panel_build_plan"
SET "hours_per_week" = GREATEST(1, CEIL("hours_per_month" / 4.0)::INTEGER);

ALTER TABLE "civic_panel_build_plan" ALTER COLUMN "hours_per_week" DROP DEFAULT;

ALTER TABLE "civic_panel_build_plan" ALTER COLUMN "hours_per_month" DROP NOT NULL;
