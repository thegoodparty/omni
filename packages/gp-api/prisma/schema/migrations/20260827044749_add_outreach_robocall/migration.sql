-- CreateTable
CREATE TABLE "outreach_robocall" (
    "id" SERIAL NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "outreach_id" INTEGER NOT NULL,
    "audio_key" TEXT NOT NULL,
    "callback_number" TEXT NOT NULL,
    "billable_count" INTEGER NOT NULL,
    "amount_in_cents" INTEGER NOT NULL,

    CONSTRAINT "outreach_robocall_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "outreach_robocall_outreach_id_key" ON "outreach_robocall"("outreach_id");

-- AddForeignKey
ALTER TABLE "outreach_robocall" ADD CONSTRAINT "outreach_robocall_outreach_id_fkey" FOREIGN KEY ("outreach_id") REFERENCES "outreach"("id") ON DELETE CASCADE ON UPDATE CASCADE;
