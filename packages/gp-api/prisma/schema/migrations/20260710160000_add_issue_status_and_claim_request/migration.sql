-- Design-audit gap fills for the public /people profile overlay.
-- 1. Per-issue progress pill on person_profile_issue (IN PROGRESS / PRIORITIZED
--    / ONGOING / RESOLVED), distinct from the existing transparency level.
-- 2. person_profile_claim_request: inbound lead capture from the unclaimed-
--    profile "claim this" modal (optional name + required email). person_id is
--    a civics reference (gp_candidate_id), not a FK — Person lives in
--    election-api.

-- CreateEnum
CREATE TYPE "PersonProfileIssueStatus" AS ENUM ('IN_PROGRESS', 'PRIORITIZED', 'ONGOING', 'RESOLVED');

-- AlterTable
ALTER TABLE "person_profile_issue" ADD COLUMN     "status" "PersonProfileIssueStatus";

-- CreateTable
CREATE TABLE "person_profile_claim_request" (
    "id" TEXT NOT NULL,
    "person_id" TEXT NOT NULL,
    "requester_name" TEXT,
    "requester_email" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "person_profile_claim_request_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "person_profile_claim_request_person_id_idx" ON "person_profile_claim_request"("person_id");
