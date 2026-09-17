-- Voter-density heat-map cells + coverage meta, populated by the data team
-- (dbt/Databricks; see packages/gp-api/docs/voter-density-heatmap-handoff.md).
-- gp-api's peopleDb reads these read-only. Both live in the `green` schema
-- (like DistrictVoter) and reuse the existing `public."USState"` enum. No H3
-- math in Postgres — (lat,lng) are precomputed H3 cell centroids.
--
-- Additive only: CREATE TABLE + CREATE INDEX for two brand-new tables. Nothing
-- here alters or drops an existing table, index, or enum.

-- CreateTable
CREATE TABLE "green"."DistrictVoterDensity" (
    "district_id" UUID NOT NULL,
    "resolution" INTEGER NOT NULL,
    "h3_index" TEXT NOT NULL,
    "lat" DOUBLE PRECISION NOT NULL,
    "lng" DOUBLE PRECISION NOT NULL,
    "voter_count" INTEGER NOT NULL,
    "State" "public"."USState" NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DistrictVoterDensity_pkey" PRIMARY KEY ("district_id","resolution","h3_index")
);

-- CreateTable
CREATE TABLE "green"."DistrictVoterDensityMeta" (
    "district_id" UUID NOT NULL,
    "resolution" INTEGER NOT NULL,
    "coverage" DOUBLE PRECISION NOT NULL,
    "min_cell_count" INTEGER NOT NULL,
    "total_voters" INTEGER NOT NULL,
    "geocoded_voters" INTEGER NOT NULL,
    "rendered_voters" INTEGER NOT NULL,
    "suppressed_cells" INTEGER NOT NULL,
    "State" "public"."USState" NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DistrictVoterDensityMeta_pkey" PRIMARY KEY ("district_id","resolution")
);

-- CreateIndex
CREATE INDEX "DistrictVoterDensity_district_id_resolution_idx" ON "green"."DistrictVoterDensity"("district_id", "resolution");
