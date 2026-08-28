-- AlterEnum
-- The single-owner claim held while an authorized robocall draft's CallHub
-- voice-broadcast campaign is being staged (created PAUSED, non-dialing). ADD
-- VALUE appends to the end of the type, matching the append-only ordering the
-- earlier hold states used, so the enum order matches what the migration
-- produces.
ALTER TYPE "RobocallSettleState" ADD VALUE 'staging';
