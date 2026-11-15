-- AlterTable
ALTER TABLE "managed_panel_wave" ADD COLUMN "replies_uploaded_at" TIMESTAMP(3);

-- Waves already sent keep closing on the reply window they were given, so
-- none in flight waits on an upload stamp that was never recorded.
UPDATE "managed_panel_wave" SET "replies_uploaded_at" = "sent_at" WHERE "sent_at" IS NOT NULL;
