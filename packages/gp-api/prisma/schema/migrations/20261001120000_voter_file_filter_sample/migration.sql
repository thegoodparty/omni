-- AlterTable
ALTER TABLE "voter_file_filter" ADD COLUMN     "sample_size" INTEGER,
ADD COLUMN     "sampled_at" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "voter_file_filter_sample_member" (
    "id" SERIAL NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "voter_file_filter_id" INTEGER NOT NULL,
    "person_id" TEXT NOT NULL,

    CONSTRAINT "voter_file_filter_sample_member_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "voter_file_filter_sample_member_voter_file_filter_id_person_key" ON "voter_file_filter_sample_member"("voter_file_filter_id", "person_id");

-- AddForeignKey
ALTER TABLE "voter_file_filter_sample_member" ADD CONSTRAINT "voter_file_filter_sample_member_voter_file_filter_id_fkey" FOREIGN KEY ("voter_file_filter_id") REFERENCES "voter_file_filter"("id") ON DELETE CASCADE ON UPDATE CASCADE;
