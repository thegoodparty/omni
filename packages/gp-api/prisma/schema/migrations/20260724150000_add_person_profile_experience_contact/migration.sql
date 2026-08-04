-- Person profile overlay: editable Recent Experience (§4, seeded from the
-- election-api spine then user-editable) plus the office-phone and
-- government-website contact fields the /public-profile editor exposes.

-- AlterTable
ALTER TABLE "person_profile" ADD COLUMN     "recent_experience" JSONB,
ADD COLUMN     "office_phone" TEXT,
ADD COLUMN     "government_website_url" TEXT;
