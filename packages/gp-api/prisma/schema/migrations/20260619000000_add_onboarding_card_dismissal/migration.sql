-- CreateEnum
CREATE TYPE "OnboardingCardKey" AS ENUM ('meet', 'priorities');

-- CreateTable
CREATE TABLE "onboarding_card_dismissal" (
    "id" TEXT NOT NULL,
    "elected_office_id" TEXT NOT NULL,
    "card_key" "OnboardingCardKey" NOT NULL,
    "dismissed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "onboarding_card_dismissal_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "onboarding_card_dismissal_elected_office_id_card_key_key" ON "onboarding_card_dismissal"("elected_office_id", "card_key");

-- AddForeignKey
ALTER TABLE "onboarding_card_dismissal" ADD CONSTRAINT "onboarding_card_dismissal_elected_office_id_fkey" FOREIGN KEY ("elected_office_id") REFERENCES "elected_office"("id") ON DELETE CASCADE ON UPDATE CASCADE;
