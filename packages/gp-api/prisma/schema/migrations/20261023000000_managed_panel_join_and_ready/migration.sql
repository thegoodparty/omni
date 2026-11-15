-- AlterEnum
ALTER TYPE "ContactStatusSource" ADD VALUE 'share_page';

-- CreateEnum
CREATE TYPE "CivicPanelJoinSource" AS ENUM ('share_page', 'text');

-- AlterTable
ALTER TABLE "managed_civic_panel" ADD COLUMN     "ready_email_sent_at" TIMESTAMP(3),
ADD COLUMN     "share_code" TEXT;

-- Existing enrollments get a code; Prisma gives new ones a nanoid.
UPDATE "managed_civic_panel"
SET "share_code" = substr(md5(random()::text || "id"), 1, 12)
WHERE "share_code" IS NULL;

ALTER TABLE "managed_civic_panel" ALTER COLUMN "share_code" SET NOT NULL;

-- CreateTable
CREATE TABLE "civic_panel_joiner" (
    "id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "organization_slug" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "person_id" TEXT NOT NULL,
    "matched" BOOLEAN NOT NULL,
    "first_name" TEXT,
    "last_name" TEXT,
    "source" "CivicPanelJoinSource" NOT NULL,

    CONSTRAINT "civic_panel_joiner_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "managed_civic_panel_share_code_key" ON "managed_civic_panel"("share_code");

-- CreateIndex
CREATE INDEX "civic_panel_joiner_organization_slug_person_id_idx" ON "civic_panel_joiner"("organization_slug", "person_id");

-- CreateIndex
CREATE UNIQUE INDEX "civic_panel_joiner_organization_slug_phone_key" ON "civic_panel_joiner"("organization_slug", "phone");

-- AddForeignKey
ALTER TABLE "civic_panel_joiner" ADD CONSTRAINT "civic_panel_joiner_organization_slug_fkey" FOREIGN KEY ("organization_slug") REFERENCES "organization"("slug") ON DELETE CASCADE ON UPDATE CASCADE;
