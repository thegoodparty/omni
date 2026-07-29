-- Product-owned overlay for public /people profiles. election-api holds the
-- read-only civics spine; this holds user-editable content + the publish/delete
-- render gate. user.person_id links a user to their canonical Person
-- (gp_candidate_id), set by reverse-ETL. person_profile_issue records per-issue
-- publication decisions over Serve priorities.

-- AlterTable
ALTER TABLE "user" ADD COLUMN     "person_id" TEXT;

-- CreateTable
CREATE TABLE "person_profile" (
    "id" TEXT NOT NULL,
    "person_id" TEXT NOT NULL,
    "user_id" INTEGER NOT NULL,
    "published_at" TIMESTAMP(3),
    "deleted_at" TIMESTAMP(3),
    "display_name" TEXT,
    "role_title_override" TEXT,
    "bio_override" TEXT,
    "cover_image_url" TEXT,
    "avatar_url" TEXT,
    "why_running" TEXT,
    "accomplishments" JSONB,
    "public_email" TEXT,
    "public_phone" TEXT,
    "website_url" TEXT,
    "instagram_url" TEXT,
    "tiktok_url" TEXT,
    "facebook_url" TEXT,
    "twitter_url" TEXT,
    "linkedin_url" TEXT,
    "default_transparency" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "person_profile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "person_profile_issue" (
    "id" TEXT NOT NULL,
    "person_profile_id" TEXT NOT NULL,
    "issue_id" TEXT NOT NULL,
    "visible" BOOLEAN NOT NULL DEFAULT true,
    "transparency" TEXT,
    "sort_order" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "person_profile_issue_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "person_profile_person_id_key" ON "person_profile"("person_id");

-- CreateIndex
CREATE UNIQUE INDEX "person_profile_user_id_key" ON "person_profile"("user_id");

-- CreateIndex
CREATE INDEX "person_profile_published_at_idx" ON "person_profile"("published_at");

-- CreateIndex
CREATE INDEX "person_profile_issue_person_profile_id_idx" ON "person_profile_issue"("person_profile_id");

-- CreateIndex
CREATE UNIQUE INDEX "person_profile_issue_person_profile_id_issue_id_key" ON "person_profile_issue"("person_profile_id", "issue_id");

-- CreateIndex
CREATE UNIQUE INDEX "user_person_id_key" ON "user"("person_id");

-- AddForeignKey
ALTER TABLE "person_profile" ADD CONSTRAINT "person_profile_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "person_profile_issue" ADD CONSTRAINT "person_profile_issue_person_profile_id_fkey" FOREIGN KEY ("person_profile_id") REFERENCES "person_profile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "person_profile_issue" ADD CONSTRAINT "person_profile_issue_issue_id_fkey" FOREIGN KEY ("issue_id") REFERENCES "priority"("id") ON DELETE CASCADE ON UPDATE CASCADE;

