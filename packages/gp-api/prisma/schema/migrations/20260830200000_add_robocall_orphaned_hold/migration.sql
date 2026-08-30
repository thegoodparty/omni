-- CreateTable
CREATE TABLE "robocall_orphaned_hold" (
    "id" SERIAL NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "payment_intent_id" TEXT NOT NULL,
    "outreach_id" INTEGER,
    "reason" TEXT NOT NULL,
    "voided_at" TIMESTAMP(3),

    CONSTRAINT "robocall_orphaned_hold_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "robocall_orphaned_hold_payment_intent_id_key" ON "robocall_orphaned_hold"("payment_intent_id");
