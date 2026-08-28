-- AlterTable
-- When the CallHub voice-broadcast was launched (START); null until the send
-- slice's dialing → dialed commit stamps it. Kept in its own migration, adjacent
-- to the enum ADD VALUEs, so no statement uses a value added in the same
-- transaction.
ALTER TABLE "outreach_robocall" ADD COLUMN "dialed_at" TIMESTAMP(3);
