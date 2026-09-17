-- Widen cron_run.run_date from DATE to TIMESTAMP(3) so a claim slot can be an
-- hour rather than only a calendar day. Every existing row was written as UTC
-- midnight, so the implicit date -> timestamp cast is lossless, and the
-- (job_name, run_date) unique constraint the lock depends on is untouched:
-- daily claimers still pass exact UTC midnight and still collapse to one row
-- per UTC day.
ALTER TABLE "cron_run" ALTER COLUMN "run_date" SET DATA TYPE TIMESTAMP(3);
