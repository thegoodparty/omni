-- AlterEnum
-- The send slice's dial states: `dialing` is the transient single-owner claim
-- held while the CallHub voice-broadcast is launched (STARTed) — the guard
-- against dialing the same run twice — and `dialed` is the terminal once the
-- launch has committed and the broadcast is dialing, awaiting completion. Each
-- ADD VALUE is its own statement (Postgres requires it) and appends to the end
-- of the type, matching the append-only ordering the earlier states used.
ALTER TYPE "RobocallSettleState" ADD VALUE 'dialing';
ALTER TYPE "RobocallSettleState" ADD VALUE 'dialed';
