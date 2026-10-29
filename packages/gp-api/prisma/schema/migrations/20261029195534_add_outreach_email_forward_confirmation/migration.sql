-- CreateTable
CREATE TABLE "outreach_email_forward_confirmation" (
    "id" SERIAL NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sender_id" INTEGER NOT NULL,

    CONSTRAINT "outreach_email_forward_confirmation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "outreach_email_forward_confirmation_sender_id_created_at_idx" ON "outreach_email_forward_confirmation"("sender_id", "created_at");

-- AddForeignKey
ALTER TABLE "outreach_email_forward_confirmation" ADD CONSTRAINT "outreach_email_forward_confirmation_sender_id_fkey" FOREIGN KEY ("sender_id") REFERENCES "outreach_email_sender"("id") ON DELETE CASCADE ON UPDATE CASCADE;
