-- CreateEnum
CREATE TYPE "ContactImportStatus" AS ENUM ('staged', 'committed', 'abandoned');

-- CreateEnum
CREATE TYPE "ContactImportMatchStatus" AS ENUM ('matched', 'ambiguous', 'unmatched');

-- CreateEnum
CREATE TYPE "ContactImportResolution" AS ENUM ('link', 'skip');

-- CreateEnum
CREATE TYPE "OrgContactLinkStatus" AS ENUM ('verified', 'unverified');

-- CreateEnum
CREATE TYPE "OrgContactLinkMethod" AS ENUM ('exact_name', 'manual');

-- CreateTable
CREATE TABLE "contact_import" (
    "id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "organization_slug" TEXT NOT NULL,
    "user_id" INTEGER,
    "file_name" TEXT NOT NULL,
    "row_count" INTEGER NOT NULL,
    "consent_affirmed_at" TIMESTAMP(3) NOT NULL,
    "status" "ContactImportStatus" NOT NULL DEFAULT 'staged',
    "committed_at" TIMESTAMP(3),

    CONSTRAINT "contact_import_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contact_import_row" (
    "id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "import_id" TEXT NOT NULL,
    "row_index" INTEGER NOT NULL,
    "first_name" TEXT NOT NULL,
    "last_name" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "address" TEXT,
    "city" TEXT,
    "zip" TEXT,
    "first_name_key" TEXT NOT NULL,
    "last_name_key" TEXT NOT NULL,
    "match_status" "ContactImportMatchStatus" NOT NULL,
    "candidate_count" INTEGER NOT NULL,
    "candidates" JSONB NOT NULL DEFAULT '[]',
    "resolution" "ContactImportResolution",
    "resolved_person_id" TEXT,

    CONSTRAINT "contact_import_row_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "org_contact" (
    "id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "organization_slug" TEXT NOT NULL,
    "first_name" TEXT NOT NULL,
    "last_name" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "address" TEXT,
    "city" TEXT,
    "zip" TEXT,
    "source_import_id" TEXT,
    "do_not_contact_at" TIMESTAMP(3),
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "org_contact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "org_contact_link" (
    "id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "organization_slug" TEXT NOT NULL,
    "org_contact_id" TEXT NOT NULL,
    "vendor_person_id" TEXT,
    "status" "OrgContactLinkStatus" NOT NULL,
    "method" "OrgContactLinkMethod" NOT NULL,
    "actor_user_id" INTEGER,
    "revoked_at" TIMESTAMP(3),

    CONSTRAINT "org_contact_link_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "contact_import_organization_slug_created_at_idx" ON "contact_import"("organization_slug", "created_at");

-- CreateIndex
CREATE INDEX "contact_import_row_import_id_match_status_row_index_idx" ON "contact_import_row"("import_id", "match_status", "row_index");

-- CreateIndex
CREATE UNIQUE INDEX "contact_import_row_import_id_row_index_key" ON "contact_import_row"("import_id", "row_index");

-- CreateIndex
CREATE INDEX "org_contact_organization_slug_idx" ON "org_contact"("organization_slug");

-- CreateIndex
CREATE INDEX "org_contact_link_org_contact_id_idx" ON "org_contact_link"("org_contact_id");

-- CreateIndex
CREATE INDEX "org_contact_link_organization_slug_vendor_person_id_idx" ON "org_contact_link"("organization_slug", "vendor_person_id");

-- AddForeignKey
ALTER TABLE "contact_import" ADD CONSTRAINT "contact_import_organization_slug_fkey" FOREIGN KEY ("organization_slug") REFERENCES "organization"("slug") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contact_import" ADD CONSTRAINT "contact_import_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contact_import_row" ADD CONSTRAINT "contact_import_row_import_id_fkey" FOREIGN KEY ("import_id") REFERENCES "contact_import"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "org_contact" ADD CONSTRAINT "org_contact_organization_slug_fkey" FOREIGN KEY ("organization_slug") REFERENCES "organization"("slug") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "org_contact" ADD CONSTRAINT "org_contact_source_import_id_fkey" FOREIGN KEY ("source_import_id") REFERENCES "contact_import"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "org_contact_link" ADD CONSTRAINT "org_contact_link_organization_slug_fkey" FOREIGN KEY ("organization_slug") REFERENCES "organization"("slug") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "org_contact_link" ADD CONSTRAINT "org_contact_link_org_contact_id_fkey" FOREIGN KEY ("org_contact_id") REFERENCES "org_contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "org_contact_link" ADD CONSTRAINT "org_contact_link_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- One active link per contact. Partial, so it lives only here.
CREATE UNIQUE INDEX "org_contact_link_one_active_key" ON "org_contact_link"("org_contact_id") WHERE "revoked_at" IS NULL;
