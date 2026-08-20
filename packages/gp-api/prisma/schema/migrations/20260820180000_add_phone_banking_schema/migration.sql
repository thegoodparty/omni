-- CreateEnum
CREATE TYPE "PhoneBankCallOutcome" AS ENUM ('answered', 'no_answer', 'voicemail', 'wrong_number', 'refused');

-- AlterEnum
ALTER TYPE "OutreachType" ADD VALUE 'nativePhoneBanking';

-- AlterTable
ALTER TABLE "outreach" ADD COLUMN     "phone_banking_list_id" INTEGER;

-- CreateTable
CREATE TABLE "contact_interaction_phone_banking" (
    "id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "organization_slug" TEXT NOT NULL,
    "person_id" TEXT NOT NULL,
    "occurred_at" TIMESTAMP(3) NOT NULL,
    "phone_banking_list_id" INTEGER,
    "outcome" "PhoneBankCallOutcome" NOT NULL,
    "support_answer" "SupportAnswer",
    "will_vote" "WillVoteAnswer",
    "note" TEXT,
    "manual" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "contact_interaction_phone_banking_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "phone_banking_list" (
    "id" SERIAL NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "organization_slug" TEXT NOT NULL,
    "voter_file_filter_id" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "script" TEXT NOT NULL,
    "sheet_count" SMALLINT NOT NULL,

    CONSTRAINT "phone_banking_list_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "phone_banking_list_entry" (
    "id" SERIAL NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "phone_banking_list_id" INTEGER NOT NULL,
    "seq" SMALLINT NOT NULL,
    "sheet_index" SMALLINT NOT NULL,
    "phone" TEXT NOT NULL,

    CONSTRAINT "phone_banking_list_entry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "phone_banking_list_entry_person" (
    "id" SERIAL NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "phone_banking_list_entry_id" INTEGER NOT NULL,
    "person_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "phone_banking_list_entry_person_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "phone_banking_suppressed_phone" (
    "id" SERIAL NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "organization_slug" TEXT NOT NULL,
    "phone" TEXT NOT NULL,

    CONSTRAINT "phone_banking_suppressed_phone_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "contact_interaction_phone_banking_organization_slug_person__idx" ON "contact_interaction_phone_banking"("organization_slug", "person_id", "occurred_at");

-- CreateIndex
CREATE UNIQUE INDEX "contact_interaction_phone_banking_phone_banking_list_id_per_key" ON "contact_interaction_phone_banking"("phone_banking_list_id", "person_id");

-- CreateIndex
CREATE INDEX "phone_banking_list_organization_slug_idx" ON "phone_banking_list"("organization_slug");

-- CreateIndex
CREATE UNIQUE INDEX "phone_banking_list_entry_phone_banking_list_id_seq_key" ON "phone_banking_list_entry"("phone_banking_list_id", "seq");

-- CreateIndex
CREATE UNIQUE INDEX "phone_banking_list_entry_phone_banking_list_id_phone_key" ON "phone_banking_list_entry"("phone_banking_list_id", "phone");

-- CreateIndex
CREATE UNIQUE INDEX "phone_banking_list_entry_person_phone_banking_list_entry_id_key" ON "phone_banking_list_entry_person"("phone_banking_list_entry_id", "person_id");

-- CreateIndex
CREATE UNIQUE INDEX "phone_banking_suppressed_phone_organization_slug_phone_key" ON "phone_banking_suppressed_phone"("organization_slug", "phone");

-- CreateIndex
CREATE UNIQUE INDEX "outreach_phone_banking_list_id_key" ON "outreach"("phone_banking_list_id");

-- AddForeignKey
ALTER TABLE "contact_interaction_phone_banking" ADD CONSTRAINT "contact_interaction_phone_banking_organization_slug_fkey" FOREIGN KEY ("organization_slug") REFERENCES "organization"("slug") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contact_interaction_phone_banking" ADD CONSTRAINT "contact_interaction_phone_banking_phone_banking_list_id_fkey" FOREIGN KEY ("phone_banking_list_id") REFERENCES "phone_banking_list"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outreach" ADD CONSTRAINT "outreach_phone_banking_list_id_fkey" FOREIGN KEY ("phone_banking_list_id") REFERENCES "phone_banking_list"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "phone_banking_list" ADD CONSTRAINT "phone_banking_list_organization_slug_fkey" FOREIGN KEY ("organization_slug") REFERENCES "organization"("slug") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "phone_banking_list" ADD CONSTRAINT "phone_banking_list_voter_file_filter_id_fkey" FOREIGN KEY ("voter_file_filter_id") REFERENCES "voter_file_filter"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "phone_banking_list_entry" ADD CONSTRAINT "phone_banking_list_entry_phone_banking_list_id_fkey" FOREIGN KEY ("phone_banking_list_id") REFERENCES "phone_banking_list"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "phone_banking_list_entry_person" ADD CONSTRAINT "phone_banking_list_entry_person_phone_banking_list_entry_i_fkey" FOREIGN KEY ("phone_banking_list_entry_id") REFERENCES "phone_banking_list_entry"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "phone_banking_suppressed_phone" ADD CONSTRAINT "phone_banking_suppressed_phone_organization_slug_fkey" FOREIGN KEY ("organization_slug") REFERENCES "organization"("slug") ON DELETE CASCADE ON UPDATE CASCADE;

