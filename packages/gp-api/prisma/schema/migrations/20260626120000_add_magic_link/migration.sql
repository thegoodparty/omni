-- CreateEnum
CREATE TYPE "MagicLinkKind" AS ENUM ('SERVE', 'WIN');

-- CreateTable
CREATE TABLE "magic_link" (
    "id" TEXT NOT NULL,
    "user_id" INTEGER NOT NULL,
    "kind" "MagicLinkKind" NOT NULL DEFAULT 'SERVE',
    "email" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "sent_at" TIMESTAMP(3) NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "redeemed_at" TIMESTAMP(3),
    "onboarding_completed_at" TIMESTAMP(3),
    "crm_contact_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "magic_link_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "magic_link_user_id_key" ON "magic_link"("user_id");

-- CreateIndex
CREATE INDEX "magic_link_email_idx" ON "magic_link"("email");

-- AddForeignKey
ALTER TABLE "magic_link" ADD CONSTRAINT "magic_link_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
