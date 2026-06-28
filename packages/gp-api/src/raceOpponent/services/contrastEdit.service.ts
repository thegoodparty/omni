import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import { ContrastResponse, EditContrastRequest } from '@goodparty_org/contracts'
import { createPrismaBase, MODELS } from '@/prisma/util/prisma.util'
import { RaceOpponentContrastStatus } from '@/generated/prisma'
import { EVENTS } from '@/vendors/segment/segment.types'
import { AnalyticsService } from '@/analytics/analytics.service'
import { contrastToDTO } from './contrastEngine.service'

// A contrast is editable only while it is candidate-actionable: cleared or the
// candidate-approved variant. pending_review / blocked / draft / discarded are
// not editable, and an already-`used` contrast is frozen — its text has already
// been routed into a story or outreach draft.
const EDITABLE_STATUSES: RaceOpponentContrastStatus[] = [
  RaceOpponentContrastStatus.cleared,
  RaceOpponentContrastStatus.approved,
]

// Owner-scoped edit of a candidate-visible contrast. Updates the candidate's
// editable text fields, increments editCount, and fires Win - Contrast Edited.
@Injectable()
export class ContrastEditService extends createPrismaBase(
  MODELS.RaceOpponentContrast,
) {
  constructor(private readonly analytics: AnalyticsService) {
    super()
  }

  async edit(
    campaignId: number,
    userId: number,
    contrastId: number,
    changes: EditContrastRequest,
  ): Promise<ContrastResponse> {
    const contrast = await this.model.findFirst({
      where: { id: contrastId, campaignId },
    })
    if (!contrast) {
      throw new NotFoundException('Contrast not found')
    }

    // Only candidate-authored fields are writable; opponentFact/sourceUrl/
    // issueTag/routing stay tied to the citation. The schema already drops the
    // others, but spell the writable set out so a wider request can't widen the
    // write. The atomic updateMany scoped to EDITABLE_STATUSES is the claim: a
    // concurrent route (Serializable) that flips status to `used` between the
    // 404 fetch and the write lands count 0, so the edit can't overwrite text
    // or bump editCount on an already-routed contrast.
    const claimed = await this.model.updateMany({
      where: {
        id: contrastId,
        campaignId,
        status: { in: EDITABLE_STATUSES },
      },
      data: {
        candidateFact: changes.candidateFact,
        contrastSentence: changes.contrastSentence,
        editCount: { increment: 1 },
      },
    })
    if (claimed.count === 0) {
      throw new ConflictException('Contrast is not in an editable state')
    }

    const updated = await this.model.findUniqueOrThrow({
      where: { id: contrastId },
    })

    void this.analytics
      .track(userId, EVENTS.RaceOpponent.ContrastEdited, {
        campaignId,
        contrastId,
      })
      .catch(() => undefined)

    return { contrast: contrastToDTO(updated) }
  }
}
