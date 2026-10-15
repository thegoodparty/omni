import { Injectable } from '@nestjs/common'
import { OnboardingCardKey, PrioritySource } from '../../generated/prisma'
import { createPrismaBase, MODELS } from '@/prisma/util/prisma.util'
import { OnboardingCard, OnboardingCardStatus } from '@goodparty_org/contracts'

// The two onboarding cards aren't generated rows like task cards — they're a
// fixed pair whose visibility is derived. A card is `completed` once it has a
// completion row (`meet` gets one when its button opens the intro) or, for
// `priorities`, once there is a user-stated priority; else `skipped` if
// dismissed, else `active`. Completion beats a prior skip. Any Chief of Staff
// conversation does not complete `meet`: the build card and "Ask about this"
// start conversations too, and those would hide the intro from a new official.
@Injectable()
export class OnboardingCardsService extends createPrismaBase(
  MODELS.OnboardingCardDismissal,
) {
  async listStatuses(electedOfficeId: string): Promise<OnboardingCard[]> {
    const [dismissals, completions, userStatedCount] = await Promise.all([
      this.client.onboardingCardDismissal.findMany({
        where: { electedOfficeId },
        select: { cardKey: true },
      }),
      this.client.onboardingCardCompletion.findMany({
        where: { electedOfficeId },
        select: { cardKey: true },
      }),
      this.client.priority.count({
        where: {
          electedOfficeId,
          source: PrioritySource.user_stated,
          archivedAt: null,
        },
      }),
    ])
    const dismissed = new Set(dismissals.map((d) => d.cardKey))
    const completed = new Set(completions.map((c) => c.cardKey))
    return [
      {
        key: OnboardingCardKey.meet,
        status: cardStatus(
          completed.has(OnboardingCardKey.meet),
          dismissed.has(OnboardingCardKey.meet),
        ),
      },
      {
        key: OnboardingCardKey.priorities,
        status: cardStatus(
          completed.has(OnboardingCardKey.priorities) || userStatedCount > 0,
          dismissed.has(OnboardingCardKey.priorities),
        ),
      },
    ]
  }

  async complete(
    electedOfficeId: string,
    cardKey: OnboardingCardKey,
  ): Promise<void> {
    await this.client.onboardingCardCompletion.upsert({
      where: { electedOfficeId_cardKey: { electedOfficeId, cardKey } },
      create: { electedOfficeId, cardKey },
      update: {},
    })
  }

  async skip(
    electedOfficeId: string,
    cardKey: OnboardingCardKey,
  ): Promise<void> {
    await this.client.onboardingCardDismissal.upsert({
      where: { electedOfficeId_cardKey: { electedOfficeId, cardKey } },
      create: { electedOfficeId, cardKey },
      update: {},
    })
  }
}

const cardStatus = (
  completed: boolean,
  skipped: boolean,
): OnboardingCardStatus =>
  completed ? 'completed' : skipped ? 'skipped' : 'active'
