-- CreateEnum
CREATE TYPE "OutreachEmailPauseReason" AS ENUM ('bounce_rate', 'complaint_rate', 'ses_account', 'ses_tenant', 'daily_quota', 'manual');

-- CreateEnum
CREATE TYPE "OutreachEmailRecipientStatus" AS ENUM ('queued', 'sending', 'sent', 'bounced', 'complained', 'failed');

-- CreateEnum
CREATE TYPE "OutreachEmailReplyClass" AS ENUM ('forwarded', 'auto_reply', 'bounce', 'unsubscribe', 'spam');

-- CreateEnum
CREATE TYPE "OutreachEmailSuppressionReason" AS ENUM ('link', 'one_click', 'reply');

-- CreateEnum
CREATE TYPE "OutreachHoldState" AS ENUM ('scheduled', 'placing', 'held', 'hold_failed', 'capturing', 'captured', 'releasing', 'released', 'uncollectable', 'disputed');

-- AlterEnum
ALTER TYPE "OutreachType" ADD VALUE 'email';

-- CreateTable
CREATE TABLE "email_sweep_lease" (
    "id" INTEGER NOT NULL,
    "holder" TEXT,
    "expires_at" TIMESTAMP(3),

    CONSTRAINT "email_sweep_lease_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "outreach_email" (
    "id" SERIAL NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "outreach_id" INTEGER NOT NULL,
    "sender_id" INTEGER NOT NULL,
    "consent_confirmed_at" TIMESTAMP(3),
    "consent_confirmed_by_user_id" INTEGER,
    "goal" TEXT NOT NULL,
    "layout" TEXT NOT NULL,
    "theme" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "headline" TEXT,
    "body" TEXT NOT NULL,
    "image_url" TEXT,
    "button_label" TEXT,
    "button_url" TEXT,
    "paid_for_by" TEXT,
    "recipient_cap" INTEGER,
    "ses_template_name" TEXT,
    "prepared_at" TIMESTAMP(3),
    "stopping_at" TIMESTAMP(3),
    "sent_count" INTEGER NOT NULL DEFAULT 0,
    "unsubscribed_count" INTEGER NOT NULL DEFAULT 0,
    "paused_at" TIMESTAMP(3),
    "pause_reason" "OutreachEmailPauseReason",
    "resumed_at" TIMESTAMP(3),

    CONSTRAINT "outreach_email_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "outreach_email_recipient" (
    "id" SERIAL NOT NULL,
    "outreach_email_id" INTEGER NOT NULL,
    "sender_id" INTEGER NOT NULL,
    "email" TEXT NOT NULL,
    "first_name" TEXT,
    "last_name" TEXT,
    "status" "OutreachEmailRecipientStatus" NOT NULL DEFAULT 'queued',
    "claimed_at" TIMESTAMP(3),
    "ses_message_id" TEXT,
    "sent_at" TIMESTAMP(3),

    CONSTRAINT "outreach_email_recipient_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "outreach_email_reply" (
    "id" SERIAL NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sender_id" INTEGER NOT NULL,
    "outreach_email_id" INTEGER,
    "from_email" TEXT NOT NULL,
    "subject" TEXT,
    "raw_object_key" TEXT NOT NULL,
    "classification" "OutreachEmailReplyClass" NOT NULL,
    "forwarded_at" TIMESTAMP(3),

    CONSTRAINT "outreach_email_reply_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "outreach_email_sender" (
    "id" SERIAL NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "organization_slug" TEXT NOT NULL,
    "local_part" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "forward_to_email" TEXT NOT NULL,
    "pending_forward_to_email" TEXT,
    "pending_forward_token_hash" TEXT,
    "pending_forward_expires_at" TIMESTAMP(3),
    "warming_step" INTEGER NOT NULL DEFAULT 0,
    "ses_tenant_name" TEXT,

    CONSTRAINT "outreach_email_sender_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "outreach_email_suppression" (
    "id" SERIAL NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "email" TEXT NOT NULL,
    "organization_slug" TEXT NOT NULL,
    "reason" "OutreachEmailSuppressionReason" NOT NULL,
    "message_type" TEXT NOT NULL DEFAULT 'all',
    "revoked_at" TIMESTAMP(3),

    CONSTRAINT "outreach_email_suppression_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "outreach_orphaned_hold" (
    "id" SERIAL NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "payment_intent_id" TEXT NOT NULL,
    "outreach_id" INTEGER,
    "reason" TEXT NOT NULL,
    "voided_at" TIMESTAMP(3),

    CONSTRAINT "outreach_orphaned_hold_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "outreach_payment_hold" (
    "id" SERIAL NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "outreach_id" INTEGER NOT NULL,
    "channel" "OutreachType" NOT NULL,
    "state" "OutreachHoldState" NOT NULL DEFAULT 'scheduled',
    "stripe_customer_id" TEXT NOT NULL,
    "payment_method_id" TEXT NOT NULL,
    "payment_intent_id" TEXT,
    "hold_attempt" INTEGER NOT NULL DEFAULT 0,
    "estimate_cents" INTEGER NOT NULL,
    "authorized_cents" INTEGER,
    "captured_cents" INTEGER,
    "capture_before" TIMESTAMP(3),
    "claimed_at" TIMESTAMP(3),
    "release_requested" BOOLEAN NOT NULL DEFAULT false,
    "decline_code" TEXT,

    CONSTRAINT "outreach_payment_hold_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "outreach_email_outreach_id_key" ON "outreach_email"("outreach_id");

-- CreateIndex
CREATE UNIQUE INDEX "outreach_email_recipient_ses_message_id_key" ON "outreach_email_recipient"("ses_message_id");

-- CreateIndex
CREATE INDEX "outreach_email_recipient_outreach_email_id_status_idx" ON "outreach_email_recipient"("outreach_email_id", "status");

-- CreateIndex
CREATE INDEX "outreach_email_recipient_status_claimed_at_idx" ON "outreach_email_recipient"("status", "claimed_at");

-- CreateIndex
CREATE INDEX "outreach_email_recipient_sender_id_email_sent_at_idx" ON "outreach_email_recipient"("sender_id", "email", "sent_at");

-- CreateIndex
CREATE UNIQUE INDEX "outreach_email_recipient_outreach_email_id_email_key" ON "outreach_email_recipient"("outreach_email_id", "email");

-- CreateIndex
CREATE UNIQUE INDEX "outreach_email_reply_raw_object_key_key" ON "outreach_email_reply"("raw_object_key");

-- CreateIndex
CREATE INDEX "outreach_email_reply_sender_id_created_at_idx" ON "outreach_email_reply"("sender_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "outreach_email_sender_organization_slug_key" ON "outreach_email_sender"("organization_slug");

-- CreateIndex
CREATE UNIQUE INDEX "outreach_email_sender_local_part_key" ON "outreach_email_sender"("local_part");

-- CreateIndex
CREATE UNIQUE INDEX "outreach_email_sender_ses_tenant_name_key" ON "outreach_email_sender"("ses_tenant_name");

-- CreateIndex
CREATE INDEX "outreach_email_suppression_organization_slug_idx" ON "outreach_email_suppression"("organization_slug");

-- CreateIndex
CREATE UNIQUE INDEX "outreach_email_suppression_email_organization_slug_message__key" ON "outreach_email_suppression"("email", "organization_slug", "message_type");

-- CreateIndex
CREATE UNIQUE INDEX "outreach_orphaned_hold_payment_intent_id_key" ON "outreach_orphaned_hold"("payment_intent_id");

-- CreateIndex
CREATE INDEX "outreach_orphaned_hold_voided_at_idx" ON "outreach_orphaned_hold"("voided_at");

-- CreateIndex
CREATE UNIQUE INDEX "outreach_payment_hold_outreach_id_key" ON "outreach_payment_hold"("outreach_id");

-- CreateIndex
CREATE UNIQUE INDEX "outreach_payment_hold_payment_intent_id_key" ON "outreach_payment_hold"("payment_intent_id");

-- CreateIndex
CREATE INDEX "outreach_payment_hold_state_claimed_at_idx" ON "outreach_payment_hold"("state", "claimed_at");

-- AddForeignKey
ALTER TABLE "outreach_email" ADD CONSTRAINT "outreach_email_outreach_id_fkey" FOREIGN KEY ("outreach_id") REFERENCES "outreach"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outreach_email" ADD CONSTRAINT "outreach_email_sender_id_fkey" FOREIGN KEY ("sender_id") REFERENCES "outreach_email_sender"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outreach_email_recipient" ADD CONSTRAINT "outreach_email_recipient_outreach_email_id_fkey" FOREIGN KEY ("outreach_email_id") REFERENCES "outreach_email"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outreach_email_recipient" ADD CONSTRAINT "outreach_email_recipient_sender_id_fkey" FOREIGN KEY ("sender_id") REFERENCES "outreach_email_sender"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outreach_email_reply" ADD CONSTRAINT "outreach_email_reply_sender_id_fkey" FOREIGN KEY ("sender_id") REFERENCES "outreach_email_sender"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outreach_email_reply" ADD CONSTRAINT "outreach_email_reply_outreach_email_id_fkey" FOREIGN KEY ("outreach_email_id") REFERENCES "outreach_email"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outreach_email_sender" ADD CONSTRAINT "outreach_email_sender_organization_slug_fkey" FOREIGN KEY ("organization_slug") REFERENCES "organization"("slug") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outreach_email_suppression" ADD CONSTRAINT "outreach_email_suppression_organization_slug_fkey" FOREIGN KEY ("organization_slug") REFERENCES "organization"("slug") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outreach_payment_hold" ADD CONSTRAINT "outreach_payment_hold_outreach_id_fkey" FOREIGN KEY ("outreach_id") REFERENCES "outreach"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- The send sweep leases this single row; see email_sweep_lease in
-- prisma/schema/emailSweepLease.prisma.
INSERT INTO "email_sweep_lease" ("id") VALUES (1);
