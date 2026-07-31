-- AlterTable
ALTER TABLE "tcr_compliance" ADD COLUMN     "filing_address_line1" TEXT,
ADD COLUMN     "filing_address_line2" TEXT,
ADD COLUMN     "filing_city" TEXT,
ADD COLUMN     "filing_state" TEXT,
ADD COLUMN     "filing_zip" TEXT;
