-- AlterTable
ALTER TABLE "campaign" ADD COLUMN     "votes_received" INTEGER;

-- AlterTable
ALTER TABLE "elected_office" ADD COLUMN     "briefing_text_reminder_at" TIMESTAMP(3),
ADD COLUMN     "briefing_text_reminder_sent_at" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "stated_first_meeting" (
    "id" TEXT NOT NULL,
    "elected_office_id" TEXT NOT NULL,
    "meeting_date" DATE NOT NULL,
    "meeting_time" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "stated_first_meeting_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "stated_first_meeting_elected_office_id_key" ON "stated_first_meeting"("elected_office_id");

-- AddForeignKey
ALTER TABLE "stated_first_meeting" ADD CONSTRAINT "stated_first_meeting_elected_office_id_fkey" FOREIGN KEY ("elected_office_id") REFERENCES "elected_office"("id") ON DELETE CASCADE ON UPDATE CASCADE;
