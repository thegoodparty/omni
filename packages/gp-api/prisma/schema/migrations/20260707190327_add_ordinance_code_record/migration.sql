-- CreateEnum
CREATE TYPE "OrdinanceDataQuality" AS ENUM ('OK', 'PARTIAL', 'UNCODIFIED', 'NOT_FOUND', 'AMBIGUOUS');

-- CreateEnum
CREATE TYPE "OrdinanceConfidence" AS ENUM ('HIGH', 'MEDIUM', 'LOW');

-- CreateEnum
CREATE TYPE "OrdinanceHostType" AS ENUM ('MUNICODE', 'ECODE360', 'AMERICAN_LEGAL', 'CODEPUBLISHING', 'ENCODEPLUS', 'MUNICIPALCODEONLINE', 'CITY_GOV', 'OTHER');

-- CreateTable
CREATE TABLE "ordinance_code_record" (
    "id" TEXT NOT NULL,
    "organization_slug" TEXT NOT NULL,
    "code_found" BOOLEAN NOT NULL,
    "data_quality" "OrdinanceDataQuality" NOT NULL,
    "confidence" "OrdinanceConfidence" NOT NULL,
    "host_type" "OrdinanceHostType",
    "url" TEXT,
    "edition_or_date" TEXT,
    "client_id" TEXT,
    "product_id" TEXT,
    "place" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "verified_evidence" TEXT NOT NULL,
    "artifact_bucket" TEXT NOT NULL,
    "artifact_key" TEXT NOT NULL,
    "superseded_note" TEXT,
    "experiment_run_id" TEXT,
    "verified_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ordinance_code_record_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ordinance_code_record_organization_slug_key" ON "ordinance_code_record"("organization_slug");

-- CreateIndex
CREATE INDEX "ordinance_code_record_experiment_run_id_idx" ON "ordinance_code_record"("experiment_run_id");

-- CreateIndex
CREATE INDEX "ordinance_code_record_state_place_idx" ON "ordinance_code_record"("state", "place");

-- AddForeignKey
ALTER TABLE "ordinance_code_record" ADD CONSTRAINT "ordinance_code_record_organization_slug_fkey" FOREIGN KEY ("organization_slug") REFERENCES "organization"("slug") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ordinance_code_record" ADD CONSTRAINT "ordinance_code_record_experiment_run_id_fkey" FOREIGN KEY ("experiment_run_id") REFERENCES "experiment_run"("run_id") ON DELETE SET NULL ON UPDATE CASCADE;
