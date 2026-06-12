-- CreateEnum
CREATE TYPE "ArtifactReviewVerdict" AS ENUM ('passed', 'failed');

-- CreateEnum
CREATE TYPE "ArtifactReviewResourceType" AS ENUM ('briefing');

-- CreateTable
CREATE TABLE "artifact_review" (
    "id" TEXT NOT NULL,
    "resource_id" TEXT NOT NULL,
    "resource_type" "ArtifactReviewResourceType" NOT NULL,
    "verdict" "ArtifactReviewVerdict" NOT NULL,
    "fail_reason" VARCHAR(2000),
    "reviewer_clerk_sub" TEXT NOT NULL,
    "reviewer_email" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "artifact_review_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "artifact_review_resource_type_resource_id_key" ON "artifact_review"("resource_type", "resource_id");
