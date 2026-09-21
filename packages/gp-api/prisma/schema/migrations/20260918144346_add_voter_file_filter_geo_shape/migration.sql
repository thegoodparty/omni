-- AlterTable
ALTER TABLE "voter_file_filter" ADD COLUMN     "geo_members_resolved_at" TIMESTAMP(3),
ADD COLUMN     "geo_poly" JSONB;

-- CreateTable
CREATE TABLE "voter_file_filter_geo_member" (
    "id" SERIAL NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "voter_file_filter_id" INTEGER NOT NULL,
    "person_id" TEXT NOT NULL,

    CONSTRAINT "voter_file_filter_geo_member_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "voter_file_filter_geo_member_voter_file_filter_id_person_id_key" ON "voter_file_filter_geo_member"("voter_file_filter_id", "person_id");

-- AddForeignKey
ALTER TABLE "voter_file_filter_geo_member" ADD CONSTRAINT "voter_file_filter_geo_member_voter_file_filter_id_fkey" FOREIGN KEY ("voter_file_filter_id") REFERENCES "voter_file_filter"("id") ON DELETE CASCADE ON UPDATE CASCADE;

