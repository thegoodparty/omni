-- The Universal Judge's chat arms read per-turn observations back over HTTP
-- while they still ran as a separate sweep. That sweep is gone, and with it the
-- route and the service, so nothing reads or writes this table. No code names
-- it any more, which is what makes the drop safe beside a rollout: Prisma lists
-- every mapped column in a SELECT, so a task serving the previous deploy still
-- thinks `judge_turn_telemetry` exists.
DROP TABLE "judge_turn_telemetry";
