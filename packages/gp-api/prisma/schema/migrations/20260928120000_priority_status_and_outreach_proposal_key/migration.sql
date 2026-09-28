-- AlterTable
ALTER TABLE "outreach" ADD COLUMN     "priority_id" TEXT,
ADD COLUMN     "proposal_key" TEXT;

-- AlterTable
ALTER TABLE "priority" ADD COLUMN     "current_step" TEXT,
ADD COLUMN     "next_action" TEXT,
ADD COLUMN     "status" JSONB;

-- CreateIndex
CREATE UNIQUE INDEX "outreach_proposal_key_key" ON "outreach"("proposal_key");

-- AddForeignKey
ALTER TABLE "outreach" ADD CONSTRAINT "outreach_priority_id_fkey" FOREIGN KEY ("priority_id") REFERENCES "priority"("id") ON DELETE SET NULL ON UPDATE CASCADE;
