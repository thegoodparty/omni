-- DropIndex
DROP INDEX "campaign_slug_idx";

-- CreateIndex
CREATE INDEX "campaign_user_id_idx" ON "campaign"("user_id");
