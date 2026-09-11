-- AlterTable
ALTER TABLE "ordinance" ADD COLUMN     "source_priority_id" TEXT;

-- CreateIndex
CREATE INDEX "ordinance_source_priority_id_idx" ON "ordinance"("source_priority_id");

-- AddForeignKey
ALTER TABLE "ordinance" ADD CONSTRAINT "ordinance_source_priority_id_fkey" FOREIGN KEY ("source_priority_id") REFERENCES "priority"("id") ON DELETE SET NULL ON UPDATE CASCADE;
