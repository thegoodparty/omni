import { Injectable } from '@nestjs/common'
import {
  ChatScope,
  OnboardingCardKey,
  PrioritySource,
} from '../../generated/prisma'
import { createPrismaBase, MODELS } from '@/prisma/util/prisma.util'
import { OnboardingCard, OnboardingCardStatus } from '@goodparty_org/contracts'

// The two onboarding cards aren't generated rows like task cards — they're a
// fixed pair whose visibility is derived. A card is `completed` once its goal
// is met (the user has a chief-of-staff conversation / a user-stated priority),
// else `skipped` if dismissed, else `active`. Completion beats a prior skip.
@Injectable()
export class OnboardingCardsService extends createPrismaBase(
  MODELS.OnboardingCardDismissal,
) {
  async listStatuses(args: {
    electedOfficeId: string
    ownerUserId: number
    organizationSlug: string
  }): Promise<OnboardingCard[]> {
    const { electedOfficeId, ownerUserId, organizationSlug } = args
    const [dismissals, userStatedCount, conversationCount] = await Promise.all([
      this.client.onboardingCardDismissal.findMany({
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
      this.client.chatConversation.count({
        where: {
          ownerUserId,
          organizationSlug,
          scope: ChatScope.chief_of_staff,
          deletedAt: null,
        },
      }),
    ])
    const dismissed = new Set(dismissals.map((d) => d.cardKey))
    return [
      {
        key: OnboardingCardKey.meet,
        status: cardStatus(
          conversationCount > 0,
          dismissed.has(OnboardingCardKey.meet),
        ),
      },
      {
        key: OnboardingCardKey.priorities,
        status: cardStatus(
          userStatedCount > 0,
          dismissed.has(OnboardingCardKey.priorities),
        ),
      },
    ]
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
