/*
  Warnings:

  - You are about to drop the column `audience_first_time_voters` on the `voter_file_filter` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "voter_file_filter" DROP COLUMN "audience_first_time_voters";
