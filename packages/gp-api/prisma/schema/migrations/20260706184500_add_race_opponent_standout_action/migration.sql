-- CreateTable
CREATE TABLE "race_opponent_standout_action" (
    "id" SERIAL NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "campaign_id" INTEGER NOT NULL,
    "order" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "sms_message" TEXT NOT NULL,
    "opponent_name" TEXT,
    "issue" TEXT NOT NULL,
    "run_id" TEXT,

    CONSTRAINT "race_opponent_standout_action_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "race_opponent_standout_action_campaign_id_order_key" ON "race_opponent_standout_action"("campaign_id", "order");

-- AddForeignKey
ALTER TABLE "race_opponent_standout_action" ADD CONSTRAINT "race_opponent_standout_action_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;
