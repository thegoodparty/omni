-- CreateTable
CREATE TABLE "robocall_orphaned_campaign" (
    "id" SERIAL NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "campaign_pk_str" TEXT NOT NULL,
    "outreach_id" INTEGER,
    "reason" TEXT NOT NULL,
    "aborted_at" TIMESTAMP(3),

    CONSTRAINT "robocall_orphaned_campaign_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "robocall_orphaned_campaign_campaign_pk_str_key" ON "robocall_orphaned_campaign"("campaign_pk_str");
