-- Voter-density heat-map serving tables, moved here from people-db
-- `green.DistrictVoterDensity` / `...Meta` so that person -> district -> density
-- is one query in one database instead of an HTTP hop plus a second datasource.
--
-- The API only ever reads these; rows are published by the gp-data-platform
-- election-api writer (see docs/voter-density-election-db-handoff.md).
--
-- Every column is NOT NULL, unlike the Race turnout columns added alongside:
-- there the loader inserts partial rows for races the model does not cover, but
-- a density cell with a null count or centroid is not a partial row, it is a
-- corrupt one. The mart either publishes a complete k-anonymized cell or
-- publishes nothing for that district.

-- CreateTable
CREATE TABLE "District_Voter_Density" (
    "resolution" INTEGER NOT NULL,
    "h3_index" TEXT NOT NULL,
    "lat" DOUBLE PRECISION NOT NULL,
    "lng" DOUBLE PRECISION NOT NULL,
    "voter_count" INTEGER NOT NULL,
    "state" TEXT NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "district_id" UUID NOT NULL,

    CONSTRAINT "District_Voter_Density_pkey" PRIMARY KEY ("district_id","resolution","h3_index")
);

-- CreateTable
CREATE TABLE "District_Voter_Density_Meta" (
    "resolution" INTEGER NOT NULL,
    "coverage" DOUBLE PRECISION NOT NULL,
    "min_cell_count" INTEGER NOT NULL,
    "total_voters" INTEGER NOT NULL,
    "geocoded_voters" INTEGER NOT NULL,
    "rendered_voters" INTEGER NOT NULL,
    "suppressed_cells" INTEGER NOT NULL,
    "state" TEXT NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "district_id" UUID NOT NULL,

    CONSTRAINT "District_Voter_Density_Meta_pkey" PRIMARY KEY ("district_id","resolution")
);

-- CreateIndex
CREATE INDEX "District_Voter_Density_district_id_resolution_idx" ON "District_Voter_Density"("district_id", "resolution");

-- AddForeignKey
ALTER TABLE "District_Voter_Density" ADD CONSTRAINT "District_Voter_Density_district_id_fkey" FOREIGN KEY ("district_id") REFERENCES "District"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "District_Voter_Density_Meta" ADD CONSTRAINT "District_Voter_Density_Meta_district_id_fkey" FOREIGN KEY ("district_id") REFERENCES "District"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
