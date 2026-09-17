-- AlterEnum
-- The fresh-charge recovery's transient single-owner claim: `charging` is held
-- while an off-session Stripe charge (NOT a hold capture) for a delivered run
-- whose authorization hold lapsed is in flight — the guard against two replicas
-- charging the same run twice. A successful charge advances the row to the
-- existing `charged` terminal; a declined card returns it to `uncollectable`
-- (with chargeIntentId set so it is not re-attempted). Appended to the end of
-- the type as its own statement (Postgres requires one ADD VALUE per statement),
-- matching the append-only ordering the earlier states used.
ALTER TYPE "RobocallSettleState" ADD VALUE 'charging';
