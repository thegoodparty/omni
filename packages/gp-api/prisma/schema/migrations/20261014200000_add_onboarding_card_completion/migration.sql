-- The Chief of Staff's "meet" card is done once the official opens it, not
-- once any Chief of Staff conversation exists: the civic panel build card,
-- "Ask about this" and other surfaces start conversations too, and those hid
-- the intro from brand-new officials.
--
-- Backfill: an office whose owner already chatted with their Chief of Staff
-- on their own (a conversation whose first turn was not a dashboard card's
-- hidden kickoff) keeps the intro hidden.

-- CreateTable
CREATE TABLE "onboarding_card_completion" (
    "id" TEXT NOT NULL,
    "elected_office_id" TEXT NOT NULL,
    "card_key" "OnboardingCardKey" NOT NULL,
    "completed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "onboarding_card_completion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "onboarding_card_completion_elected_office_id_card_key_key" ON "onboarding_card_completion"("elected_office_id", "card_key");

-- AddForeignKey
ALTER TABLE "onboarding_card_completion" ADD CONSTRAINT "onboarding_card_completion_elected_office_id_fkey" FOREIGN KEY ("elected_office_id") REFERENCES "elected_office"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill
INSERT INTO "onboarding_card_completion" ("id", "elected_office_id", "card_key", "completed_at")
SELECT gen_random_uuid()::text, eo."id", 'meet', CURRENT_TIMESTAMP
FROM "elected_office" eo
WHERE EXISTS (
    SELECT 1
    FROM "chat_conversation" c
    WHERE c."owner_user_id" = eo."user_id"
      AND c."organization_slug" = eo."organization_slug"
      AND c."scope" = 'chief_of_staff'
      AND c."deleted_at" IS NULL
      AND NOT EXISTS (
          SELECT 1
          FROM "chat_message" m
          WHERE m."conversation_id" = c."id"
            AND m."role" = 'user'
            AND m."created_at" = (
                SELECT MIN(m2."created_at")
                FROM "chat_message" m2
                WHERE m2."conversation_id" = c."id"
                  AND m2."role" = 'user'
            )
            AND (
                m."content" LIKE '[Build civic panel]%'
                OR m."content" LIKE 'Help me with this task from my dashboard:%'
            )
      )
);
