-- CreateEnum
CREATE TYPE "DashboardCardType" AS ENUM ('briefing', 'agenda_item');

-- CreateTable
CREATE TABLE "dashboard_card" (
    "id" TEXT NOT NULL,
    "elected_office_id" TEXT NOT NULL,
    "type" "DashboardCardType" NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "cta_label" TEXT NOT NULL,
    "cta_href" TEXT NOT NULL,
    "due_date" TIMESTAMP(3) NOT NULL,
    "source_briefing_id" TEXT NOT NULL,
    "source_item_id" TEXT,
    "dismissed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "dashboard_card_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "dashboard_card_elected_office_id_dismissed_at_due_date_idx" ON "dashboard_card"("elected_office_id", "dismissed_at", "due_date");

-- CreateIndex
CREATE UNIQUE INDEX "dashboard_card_elected_office_id_type_source_briefing_id_so_key" ON "dashboard_card"("elected_office_id", "type", "source_briefing_id", "source_item_id");

-- AddForeignKey
ALTER TABLE "dashboard_card" ADD CONSTRAINT "dashboard_card_elected_office_id_fkey" FOREIGN KEY ("elected_office_id") REFERENCES "elected_office"("id") ON DELETE CASCADE ON UPDATE CASCADE;
