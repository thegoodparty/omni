import { Injectable, NotFoundException } from '@nestjs/common'
import {
  RecordDoorKnockInteraction,
  RecordDoorKnockInteractionResponse,
} from '@goodparty_org/contracts'
import { createPrismaBase, MODELS } from '@/prisma/util/prisma.util'
import { ContactInteractionDoorKnockService } from '@/contactInteraction/services/contactInteractionDoorKnock.service'
import { Organization } from '../../generated/prisma'
import { deriveKnockStatus } from '../utils/knockStatus.util'

@Injectable()
export class DoorKnockingInteractionService extends createPrismaBase(
  MODELS.DoorKnockingStopTarget,
) {
  constructor(
    private readonly doorKnockInteractions: ContactInteractionDoorKnockService,
  ) {
    super()
  }

  // The phone sends only the frozen stopTargetId + answers + clientKey;
  // personId resolves from the stop target, org comes from auth, occurredAt
  // is server-stamped. The write goes through the CRM's recordIdempotent
  // (upsert on (organizationSlug, sourceId=clientKey), conflict enforced at
  // the DB): a replayed clientKey re-syncs the same row — never a duplicate.
  async record(
    organization: Organization,
    input: RecordDoorKnockInteraction,
  ): Promise<RecordDoorKnockInteractionResponse> {
    const target = await this.findFirst({
      where: {
        id: input.stopTargetId,
        stop: {
          route: {
            turf: {
              voterFileFilter: { organizationSlug: organization.slug },
            },
          },
        },
      },
      select: { personId: true },
    })
    if (!target) {
      throw new NotFoundException('Stop target not found')
    }

    const interaction = await this.doorKnockInteractions.recordIdempotent({
      organizationSlug: organization.slug,
      personId: target.personId,
      occurredAt: new Date(),
      outcome: input.outcome,
      supportAnswer: input.supportAnswer ?? null,
      willVote: input.willVote ?? null,
      note: input.note ?? null,
      sourceId: input.clientKey,
      manual: false,
    })

    return {
      personId: interaction.personId,
      knockStatus: deriveKnockStatus(interaction),
    }
  }
}
