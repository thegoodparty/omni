-- CreateEnum
CREATE TYPE "PollAudienceKind" AS ENUM ('sample', 'list');

-- AlterEnum
ALTER TYPE "OutreachType" ADD VALUE 'poll';

-- CreateTable
CREATE TABLE "outreach_poll" (
    "outreach_id" INTEGER NOT NULL,
    "topic" TEXT NOT NULL,
    "tone" TEXT,
    "audience_kind" "PollAudienceKind" NOT NULL,
    "bias_overridden" BOOLEAN NOT NULL DEFAULT false,
    "last_analysis_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "outreach_poll_pkey" PRIMARY KEY ("outreach_id")
);

-- CreateTable
CREATE TABLE "outreach_poll_expansion" (
    "id" TEXT NOT NULL,
    "outreach_id" INTEGER NOT NULL,
    "send_seq" INTEGER NOT NULL,
    "text_count" INTEGER NOT NULL,
    "status" "OutreachStatus" NOT NULL,
    "stripe_checkout_session_id" TEXT,
    "approved_at" TIMESTAMP(3),
    "approved_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "denied_at" TIMESTAMP(3),
    "denied_by" TEXT,
    "denied_reason" TEXT,

    CONSTRAINT "outreach_poll_expansion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "outreach_reply_flag" (
    "user_id" INTEGER NOT NULL,
    "reply_id" TEXT NOT NULL,
    "favorited_at" TIMESTAMP(3),
    "read_at" TIMESTAMP(3),

    CONSTRAINT "outreach_reply_flag_pkey" PRIMARY KEY ("user_id","reply_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "outreach_poll_expansion_outreach_id_send_seq_key" ON "outreach_poll_expansion"("outreach_id", "send_seq");

-- AddForeignKey
ALTER TABLE "outreach_poll" ADD CONSTRAINT "outreach_poll_outreach_id_fkey" FOREIGN KEY ("outreach_id") REFERENCES "outreach"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outreach_poll_expansion" ADD CONSTRAINT "outreach_poll_expansion_outreach_id_fkey" FOREIGN KEY ("outreach_id") REFERENCES "outreach_poll"("outreach_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outreach_reply_flag" ADD CONSTRAINT "outreach_reply_flag_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outreach_reply_flag" ADD CONSTRAINT "outreach_reply_flag_reply_id_fkey" FOREIGN KEY ("reply_id") REFERENCES "poll_individual_message"("id") ON DELETE CASCADE ON UPDATE CASCADE;

