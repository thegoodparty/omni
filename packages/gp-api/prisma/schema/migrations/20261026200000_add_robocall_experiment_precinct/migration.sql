-- CreateTable
CREATE TABLE "robocall_experiment_precinct" (
    "id" SERIAL NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "experiment_key" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "county" TEXT NOT NULL,
    "precinct" TEXT NOT NULL,
    "arm" TEXT NOT NULL,
    "p_treatment" DOUBLE PRECISION NOT NULL,
    "assigned_for_district_id" TEXT NOT NULL,
    "assigned_for_campaign_id" INTEGER NOT NULL,
    "landlines_at_assignment" INTEGER NOT NULL,

    CONSTRAINT "robocall_experiment_precinct_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "robocall_experiment_precinct_experiment_key_state_county_pr_key" ON "robocall_experiment_precinct"("experiment_key", "state", "county", "precinct");
