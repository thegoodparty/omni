-- AlterEnum
-- The capture slice's transient single-owner claim: `capturing` is held while
-- the actual Stripe capture of the authorized hold is in flight — the guard
-- against two replicas capturing the same run twice. A successful capture
-- advances the row to the existing `captured` terminal; a lapsed hold to
-- `uncollectable`, a zero-billable run to `voided`. Appended to the end of the
-- type as its own statement (Postgres requires one ADD VALUE per statement),
-- matching the append-only ordering the earlier states used.
ALTER TYPE "RobocallSettleState" ADD VALUE 'capturing';
