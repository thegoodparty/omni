-- CreateEnum
CREATE TYPE "PrioritySource" AS ENUM ('win_import', 'user_stated');

-- CreateTable
CREATE TABLE "priority" (
    "id" TEXT NOT NULL,
    "elected_office_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "source" "PrioritySource" NOT NULL,
    "source_campaign_position_id" INTEGER,
    "target_date" DATE,
    "archived_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "priority_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "priority_elected_office_id_archived_at_idx" ON "priority"("elected_office_id", "archived_at");

-- AddForeignKey
ALTER TABLE "priority" ADD CONSTRAINT "priority_elected_office_id_fkey" FOREIGN KEY ("elected_office_id") REFERENCES "elected_office"("id") ON DELETE CASCADE ON UPDATE CASCADE;
