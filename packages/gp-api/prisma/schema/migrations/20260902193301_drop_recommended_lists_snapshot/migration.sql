/*
  Warnings:

  - You are about to drop the `recommended_lists_snapshot` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "recommended_lists_snapshot" DROP CONSTRAINT "recommended_lists_snapshot_campaign_id_fkey";

-- DropTable
DROP TABLE "recommended_lists_snapshot";
