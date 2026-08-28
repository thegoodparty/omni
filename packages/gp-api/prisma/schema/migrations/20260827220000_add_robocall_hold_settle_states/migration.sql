-- AlterEnum
-- Two intermediate states for the pay-time hold placement: hold_pending is the
-- single-owner claim held while the Stripe hold is in flight, hold_failed the
-- terminal for a declined card. Each ADD VALUE is its own statement (Postgres
-- requires it) and appends to the end of the type.
ALTER TYPE "RobocallSettleState" ADD VALUE 'hold_pending';
ALTER TYPE "RobocallSettleState" ADD VALUE 'hold_failed';
