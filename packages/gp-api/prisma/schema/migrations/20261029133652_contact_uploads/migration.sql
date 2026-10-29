-- CreateEnum
CREATE TYPE "ContactUploadStatus" AS ENUM ('processing', 'needs_input', 'complete', 'failed');

-- CreateEnum
CREATE TYPE "ContactUploadMatchOutcome" AS ENUM ('pending', 'matched', 'new', 'needs_input', 'resolved', 'skipped', 'invalid');

-- CreateEnum
CREATE TYPE "ContactUploadMatchMethod" AS ENUM ('prior_upload', 'name_and_phone', 'name_and_address', 'manual');

-- CreateTable
CREATE TABLE "contact_upload" (
    "id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "organization_slug" TEXT NOT NULL,
    "user_id" INTEGER,
    "name" TEXT NOT NULL,
    "file_name" TEXT NOT NULL,
    "file_key" TEXT NOT NULL,
    "first_name_column" TEXT NOT NULL,
    "last_name_column" TEXT NOT NULL,
    "email_column" TEXT,
    "cell_phone_column" TEXT,
    "landline_column" TEXT,
    "address_line_column" TEXT,
    "city_column" TEXT,
    "zip_column" TEXT,
    "consent_affirmed_at" TIMESTAMP(3) NOT NULL,
    "status" "ContactUploadStatus" NOT NULL DEFAULT 'processing',
    "row_count" INTEGER NOT NULL,
    "matched_count" INTEGER NOT NULL DEFAULT 0,
    "new_count" INTEGER NOT NULL DEFAULT 0,
    "needs_input_count" INTEGER NOT NULL DEFAULT 0,
    "skipped_count" INTEGER NOT NULL DEFAULT 0,
    "invalid_count" INTEGER NOT NULL DEFAULT 0,
    "updated_count" INTEGER NOT NULL DEFAULT 0,
    "unchanged_count" INTEGER NOT NULL DEFAULT 0,
    "completed_at" TIMESTAMP(3),
    "failure_reason" TEXT,

    CONSTRAINT "contact_upload_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contact_upload_match" (
    "id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "upload_id" TEXT NOT NULL,
    "organization_slug" TEXT NOT NULL,
    "row_index" INTEGER NOT NULL,
    "first_name" TEXT,
    "last_name" TEXT,
    "email" TEXT,
    "cell_phone" TEXT,
    "landline" TEXT,
    "address_line" TEXT,
    "city" TEXT,
    "zip" TEXT,
    "outcome" "ContactUploadMatchOutcome" NOT NULL DEFAULT 'pending',
    "method" "ContactUploadMatchMethod",
    "person_id" TEXT,
    "is_new_person" BOOLEAN NOT NULL DEFAULT false,
    "candidate_person_ids" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "suggested_person_id" TEXT,
    "changed_fields" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "resolved_at" TIMESTAMP(3),
    "resolved_by_user_id" INTEGER,

    CONSTRAINT "contact_upload_match_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "contact_upload_organization_slug_created_at_idx" ON "contact_upload"("organization_slug", "created_at");

-- CreateIndex
CREATE INDEX "contact_upload_match_upload_id_outcome_row_index_idx" ON "contact_upload_match"("upload_id", "outcome", "row_index");

-- CreateIndex
CREATE INDEX "contact_upload_match_organization_slug_person_id_idx" ON "contact_upload_match"("organization_slug", "person_id");

-- CreateIndex
CREATE INDEX "contact_upload_match_organization_slug_email_idx" ON "contact_upload_match"("organization_slug", "email");

-- CreateIndex
CREATE INDEX "contact_upload_match_organization_slug_cell_phone_idx" ON "contact_upload_match"("organization_slug", "cell_phone");

-- CreateIndex
CREATE INDEX "contact_upload_match_organization_slug_landline_idx" ON "contact_upload_match"("organization_slug", "landline");

-- CreateIndex
CREATE UNIQUE INDEX "contact_upload_match_upload_id_row_index_key" ON "contact_upload_match"("upload_id", "row_index");

-- AddForeignKey
ALTER TABLE "contact_upload" ADD CONSTRAINT "contact_upload_organization_slug_fkey" FOREIGN KEY ("organization_slug") REFERENCES "organization"("slug") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contact_upload" ADD CONSTRAINT "contact_upload_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contact_upload_match" ADD CONSTRAINT "contact_upload_match_upload_id_fkey" FOREIGN KEY ("upload_id") REFERENCES "contact_upload"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contact_upload_match" ADD CONSTRAINT "contact_upload_match_resolved_by_user_id_fkey" FOREIGN KEY ("resolved_by_user_id") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

