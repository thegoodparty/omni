import { Injectable, NotFoundException } from '@nestjs/common'
import {
  RecordDoorKnockInteraction,
  RecordDoorKnockInteractionResponse,
} from '@goodparty_org/contracts'
import { createPrismaBase, MODELS } from '@/prisma/util/prisma.util'
import { Organization } from '../../generated/prisma'
import { deriveKnockStatus } from '../utils/knockStatus.util'

@Injectable()
export class DoorKnockingInteractionService extends createPrismaBase(
  MODELS.ContactInteractionDoorKnock,
) {
  // The phone sends only the frozen stopTargetId + answers + clientKey;
  // personId resolves from the stop target, org comes from auth, occurredAt
  // is server-stamped. The upsert on (organizationSlug, sourceId=clientKey)
  // makes dead-zone replays return the original row — never a duplicate,
  // never an update (the first write wins; a retry is evidence of a lost
  // response, not a changed answer).
  async record(
    organization: Organization,
    input: RecordDoorKnockInteraction,
  ): Promise<RecordDoorKnockInteractionResponse> {
    const target = await this.client.doorKnockingStopTarget.findFirst({
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

    const interaction = await this.model.upsert({
      where: {
        organizationSlug_sourceId: {
          organizationSlug: organization.slug,
          sourceId: input.clientKey,
        },
      },
      create: {
        organizationSlug: organization.slug,
        personId: target.personId,
        occurredAt: new Date(),
        outcome: input.outcome,
        supportAnswer: input.supportAnswer ?? null,
        willVote: input.willVote ?? null,
        note: input.note ?? null,
        sourceId: input.clientKey,
        manual: false,
      },
      update: {},
    })

    return {
      personId: interaction.personId,
      knockStatus: deriveKnockStatus(interaction),
    }
  }
}
