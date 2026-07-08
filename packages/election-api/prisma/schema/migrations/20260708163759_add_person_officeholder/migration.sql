-- Person + OfficeHolder spine for public /people profiles (person-grain, keyed
-- on the civics canonical gp_candidate_id). Rows are written by gp-data-platform
-- ETL; the application only reads them. Candidacy gains a person_id FK so a
-- Person can be joined to both its candidacies and its office terms. All columns
-- are nullable where BallotReady coverage is partial.

-- AlterTable
ALTER TABLE "Candidacy" ADD COLUMN     "person_id" UUID;

-- CreateTable
CREATE TABLE "OfficeHolder" (
    "id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "br_office_holder_id" INTEGER,
    "position_name" TEXT,
    "normalized_position_name" TEXT,
    "office_title" TEXT,
    "party_names" TEXT[],
    "start_at" DATE,
    "end_at" DATE,
    "term_date_specificity" TEXT,
    "is_current" BOOLEAN,
    "is_appointed" BOOLEAN,
    "is_vacant" BOOLEAN,
    "number_of_seats" INTEGER,
    "mailing_address_line_1" TEXT,
    "mailing_address_line_2" TEXT,
    "mailing_city" TEXT,
    "mailing_state" TEXT,
    "mailing_zip" TEXT,
    "office_phone" TEXT,
    "office_email" TEXT,
    "website_url" TEXT,
    "linkedin_url" TEXT,
    "facebook_url" TEXT,
    "twitter_url" TEXT,
    "sub_area_name" TEXT,
    "sub_area_value" TEXT,
    "state" TEXT,
    "geo_id" TEXT,
    "mtfcc" TEXT,
    "person_id" UUID NOT NULL,
    "position_id" UUID,

    CONSTRAINT "OfficeHolder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Person" (
    "id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "br_person_id" INTEGER,
    "slug" TEXT NOT NULL,
    "first_name" TEXT,
    "middle_name" TEXT,
    "last_name" TEXT,
    "nickname" TEXT,
    "suffix" TEXT,
    "full_name" TEXT,
    "bio_text" TEXT,
    "headshot_url" TEXT,
    "website_url" TEXT,
    "linkedin_url" TEXT,
    "facebook_url" TEXT,
    "twitter_url" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "degrees" JSONB,
    "experiences" JSONB,
    "state" TEXT,

    CONSTRAINT "Person_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OfficeHolder_person_id_idx" ON "OfficeHolder"("person_id");

-- CreateIndex
CREATE INDEX "OfficeHolder_position_id_idx" ON "OfficeHolder"("position_id");

-- CreateIndex
CREATE UNIQUE INDEX "Person_slug_key" ON "Person"("slug");

-- CreateIndex
CREATE INDEX "Candidacy_person_id_idx" ON "Candidacy"("person_id");

-- AddForeignKey
ALTER TABLE "Candidacy" ADD CONSTRAINT "Candidacy_person_id_fkey" FOREIGN KEY ("person_id") REFERENCES "Person"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OfficeHolder" ADD CONSTRAINT "OfficeHolder_person_id_fkey" FOREIGN KEY ("person_id") REFERENCES "Person"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OfficeHolder" ADD CONSTRAINT "OfficeHolder_position_id_fkey" FOREIGN KEY ("position_id") REFERENCES "Position"("id") ON DELETE SET NULL ON UPDATE CASCADE;
