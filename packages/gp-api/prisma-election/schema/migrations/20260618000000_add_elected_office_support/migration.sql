-- CreateTable
CREATE TABLE "Elected_Office_Support" (
    "elected_office_id" UUID NOT NULL,
    "support_constituents" INTEGER NOT NULL,
    "total_constituents" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Elected_Office_Support_pkey" PRIMARY KEY ("elected_office_id")
);
