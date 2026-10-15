-- A Serve text can ask constituents onto the official's civic panel: the
-- message carries a fixed "Reply JOIN" sentence, and a JOIN reply sets the
-- person's civic_panel status to member.
--
-- `asks_to_join_civic_panel` is set at create from the stored message, so the
-- reply ingest only reads JOIN off a send that actually asked. A JOIN to any
-- other text means nothing and must not enrol anyone.
--
-- `sms` joins ContactStatusSource for the writes the ingest makes: a JOIN
-- reply adding someone, and a STOP reply taking them off the panel.
--
-- Additive only: `ALTER TYPE ... ADD VALUE` and a defaulted column.

-- AlterEnum
ALTER TYPE "ContactStatusSource" ADD VALUE 'sms';

-- AlterTable
ALTER TABLE "outreach" ADD COLUMN "asks_to_join_civic_panel" BOOLEAN NOT NULL DEFAULT false;
