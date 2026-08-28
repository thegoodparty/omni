-- CreateTable
CREATE TABLE "robocall_compliance_result" (
    "id" SERIAL NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "audio_key" TEXT NOT NULL,
    "passed" BOOLEAN NOT NULL,
    "checked_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "robocall_compliance_result_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "robocall_compliance_result_audio_key_key" ON "robocall_compliance_result"("audio_key");

-- AlterTable
-- Per-draft mirror of the passing compliance verdict, stamped at create so the
-- send slice has a durable per-draft fact to gate the dial on. Nullable and
-- additive; existing rows stay null.
ALTER TABLE "outreach_robocall" ADD COLUMN "compliance_passed_at" TIMESTAMP(3);
