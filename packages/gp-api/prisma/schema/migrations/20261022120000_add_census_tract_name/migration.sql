-- CreateEnum
CREATE TYPE "CensusTractNameSource" AS ENUM ('neighborhood', 'street', 'none');

-- CreateTable
CREATE TABLE "census_tract_name" (
    "tract_geoid" TEXT NOT NULL,
    "name" TEXT,
    "source" "CensusTractNameSource" NOT NULL,
    "street" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "census_tract_name_pkey" PRIMARY KEY ("tract_geoid")
);
