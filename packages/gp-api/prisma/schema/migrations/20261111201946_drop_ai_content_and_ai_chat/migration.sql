/*
  Warnings:

  - You are about to drop the column `ai_content` on the `campaign` table. All the data in the column will be lost.
  - You are about to drop the `ai_chat` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "ai_chat" DROP CONSTRAINT "ai_chat_campaign_id_fkey";

-- DropForeignKey
ALTER TABLE "ai_chat" DROP CONSTRAINT "ai_chat_user_id_fkey";

-- AlterTable
ALTER TABLE "campaign" DROP COLUMN "ai_content";

-- DropTable
DROP TABLE "ai_chat";
