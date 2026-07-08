import { ForbiddenException, Injectable } from '@nestjs/common'
import { createPrismaBase, MODELS } from '@/prisma/util/prisma.util'
import {
  RaceOpponentFindingKind,
  RaceOpponentResearchStatus,
} from '@/generated/prisma'

// Server-side hard gate (PRD Requirement B): opponent research is unavailable
// until the candidate's own self-research pass has completed. This is enforced
// in code with a 4xx — not a UI flag and not a 500 — so an opponent endpoint
// can't be reached before self-research is done, regardless of client state.
@Injectable()
export class SelfResearchGateService extends createPrismaBase(
  MODELS.RaceOpponentResearch,
) {
  async assertSelfResearchComplete(campaignId: number): Promise<void> {
    const self = await this.model.findFirst({
      where: {
        campaignId,
        kind: RaceOpponentFindingKind.self,
        status: RaceOpponentResearchStatus.completed,
      },
      select: { id: true },
    })
    if (!self) {
      throw new ForbiddenException(
        'Complete your self-research pass before researching opponents.',
      )
    }
  }
}
