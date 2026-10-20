-- CreateEnum
CREATE TYPE "PriorityAnswerSource" AS ENUM ('text', 'phone_banking', 'door_knocking');

-- CreateEnum
CREATE TYPE "PriorityAnswerCode" AS ENUM ('yes', 'no', 'mixed', 'not_an_answer');

-- CreateTable
CREATE TABLE "priority_answer" (
    "id" TEXT NOT NULL,
    "organization_slug" TEXT NOT NULL,
    "outreach_id" INTEGER NOT NULL,
    "person_id" TEXT NOT NULL,
    "source" "PriorityAnswerSource" NOT NULL,
    "source_id" TEXT NOT NULL,
    "code" "PriorityAnswerCode" NOT NULL,
    "model" TEXT NOT NULL,
    "coded_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "priority_answer_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "priority_answer_outreach_id_idx" ON "priority_answer"("outreach_id");

-- CreateIndex
CREATE UNIQUE INDEX "priority_answer_organization_slug_source_source_id_key" ON "priority_answer"("organization_slug", "source", "source_id");

-- AddForeignKey
ALTER TABLE "priority_answer" ADD CONSTRAINT "priority_answer_organization_slug_fkey" FOREIGN KEY ("organization_slug") REFERENCES "organization"("slug") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "priority_answer" ADD CONSTRAINT "priority_answer_outreach_id_fkey" FOREIGN KEY ("outreach_id") REFERENCES "outreach"("id") ON DELETE CASCADE ON UPDATE CASCADE;
