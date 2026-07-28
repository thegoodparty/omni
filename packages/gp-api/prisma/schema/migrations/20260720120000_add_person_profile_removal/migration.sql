-- Privacy takedown flag for public /people profiles. When a person requests
-- removal, the public page renders the minimal "removal requested" states
-- (K/L) instead of 404/410. person_id is a civics reference (gp_candidate_id),
-- not a FK — removal usually applies to unclaimed persons with no User/profile,
-- and Person lives in election-api. Unique on person_id so the flag is
-- idempotent.

-- CreateTable
CREATE TABLE "person_profile_removal" (
    "id" TEXT NOT NULL,
    "person_id" TEXT NOT NULL,
    "note" TEXT,
    "requested_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "person_profile_removal_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "person_profile_removal_person_id_key" ON "person_profile_removal"("person_id");
