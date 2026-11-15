-- AlterTable
ALTER TABLE "contact_upload" ADD COLUMN     "process_job_id" UUID;

-- CreateIndex
CREATE INDEX "contact_upload_status_organization_slug_idx" ON "contact_upload"("status", "organization_slug");
