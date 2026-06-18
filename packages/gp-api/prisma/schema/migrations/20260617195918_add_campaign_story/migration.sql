-- CreateTable
CREATE TABLE "campaign_story" (
    "id" SERIAL NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "campaign_id" INTEGER NOT NULL,
    "why" TEXT,
    "background" TEXT,
    "issues" TEXT,

    CONSTRAINT "campaign_story_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "campaign_story_campaign_id_key" ON "campaign_story"("campaign_id");

-- AddForeignKey
ALTER TABLE "campaign_story" ADD CONSTRAINT "campaign_story_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;
