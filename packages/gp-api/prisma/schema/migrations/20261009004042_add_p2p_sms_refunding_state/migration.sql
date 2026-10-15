-- AlterEnum
-- The in-flight single-owner claim for the charge-keyed refund terminal (Win
-- SMS hold slice E). Only an ADD VALUE, used by no statement in this migration,
-- so it is safe in the implicit transaction the migration replay runs under.
ALTER TYPE "P2pSmsSettleState" ADD VALUE 'refunding';
