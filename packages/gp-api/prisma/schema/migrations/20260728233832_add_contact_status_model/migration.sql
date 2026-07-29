-- CreateEnum
CREATE TYPE "VoterLikelihood" AS ENUM ('unknown', 'first_time', 'unlikely', 'likely', 'super');

-- CreateEnum
CREATE TYPE "ContactStatusField" AS ENUM ('voter_likelihood', 'support_status');

-- CreateEnum
CREATE TYPE "ContactStatusSource" AS ENUM ('manual', 'door_knock', 'phone_banking');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "SupportStatusRollup" ADD VALUE 'undecided';
ALTER TYPE "SupportStatusRollup" ADD VALUE 'refused';

-- CreateTable
CREATE TABLE "contact_status_event" (
    "id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "organization_slug" TEXT NOT NULL,
    "person_id" TEXT NOT NULL,
    "field" "ContactStatusField" NOT NULL,
    "from_value" TEXT,
    "to_value" TEXT NOT NULL,
    "source" "ContactStatusSource" NOT NULL,
    "actor_user_id" INTEGER,
    "source_id" TEXT,

    CONSTRAINT "contact_status_event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contact_current_status" (
    "id" TEXT NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "organization_slug" TEXT NOT NULL,
    "person_id" TEXT NOT NULL,
    "field" "ContactStatusField" NOT NULL,
    "value" TEXT NOT NULL,

    CONSTRAINT "contact_current_status_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "contact_status_event_organization_slug_person_id_created_at_idx" ON "contact_status_event"("organization_slug", "person_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "contact_status_event_organization_slug_field_source_id_key" ON "contact_status_event"("organization_slug", "field", "source_id");

-- CreateIndex
CREATE INDEX "contact_current_status_organization_slug_field_value_idx" ON "contact_current_status"("organization_slug", "field", "value");

-- CreateIndex
CREATE UNIQUE INDEX "contact_current_status_organization_slug_person_id_field_key" ON "contact_current_status"("organization_slug", "person_id", "field");

-- AddForeignKey
ALTER TABLE "contact_status_event" ADD CONSTRAINT "contact_status_event_organization_slug_fkey" FOREIGN KEY ("organization_slug") REFERENCES "organization"("slug") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contact_status_event" ADD CONSTRAINT "contact_status_event_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contact_current_status" ADD CONSTRAINT "contact_current_status_organization_slug_fkey" FOREIGN KEY ("organization_slug") REFERENCES "organization"("slug") ON DELETE CASCADE ON UPDATE CASCADE;

