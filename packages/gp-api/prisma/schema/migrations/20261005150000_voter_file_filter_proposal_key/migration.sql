-- AlterTable
ALTER TABLE "voter_file_filter" ADD COLUMN     "proposal_key" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "voter_file_filter_proposal_key_key" ON "voter_file_filter"("proposal_key");
