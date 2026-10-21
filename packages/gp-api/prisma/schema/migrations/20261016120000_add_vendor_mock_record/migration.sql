-- CreateEnum
CREATE TYPE "VendorMockVendor" AS ENUM ('peerly', 'callhub', 'geoapify', 'vercel', 'route53');

-- CreateTable
CREATE TABLE "vendor_mock_record" (
    "id" TEXT NOT NULL,
    "vendor" "VendorMockVendor" NOT NULL,
    "kind" TEXT NOT NULL,
    "external_id" TEXT NOT NULL,
    "campaign_id" INTEGER,
    "state" JSONB NOT NULL,
    "requests" JSONB NOT NULL DEFAULT '[]',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vendor_mock_record_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "vendor_mock_record_campaign_id_idx" ON "vendor_mock_record"("campaign_id");

-- CreateIndex
CREATE UNIQUE INDEX "vendor_mock_record_vendor_kind_external_id_key" ON "vendor_mock_record"("vendor", "kind", "external_id");
