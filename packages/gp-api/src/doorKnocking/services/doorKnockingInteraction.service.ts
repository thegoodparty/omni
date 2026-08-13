import { Injectable, NotFoundException } from '@nestjs/common'
import {
  RecordDoorKnockInteraction,
  RecordDoorKnockInteractionResponse,
  SetDoNotKnock,
  SetDoNotKnockResponse,
} from '@goodparty_org/contracts'
import { createPrismaBase, MODELS } from '@/prisma/util/prisma.util'
import { ContactInteractionDoorKnockService } from '@/contactInteraction/services/contactInteractionDoorKnock.service'
import { ContactStatusService } from '@/contactInteraction/services/contactStatus.service'
import {
  ContactStatusField,
  ContactStatusSource,
  DoNotKnockStatus,
  Organization,
} from '../../generated/prisma'
import { deriveKnockStatus } from '../utils/knockStatus.util'

@Injectable()
export class DoorKnockingInteractionService extends createPrismaBase(
  MODELS.DoorKnockingStopTarget,
) {
  constructor(
    private readonly doorKnockInteractions: ContactInteractionDoorKnockService,
    private readonly contactStatus: ContactStatusService,
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
    const personId = await this.personIdForTarget(
      organization.slug,
      input.stopTargetId,
    )

    const interaction = await this.doorKnockInteractions.recordIdempotent({
      organizationSlug: organization.slug,
      personId,
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

  // ADR 0007. Its own endpoint rather than a field on the knock payload: a
  // do-not-knock is recordable when there is no outcome worth logging, and it
  // has to be reversible on its own.
  //
  // No sourceId, even though the source is door_knock — that key exists for
  // replayed activity syncs, and changeStatus already no-ops when the value is
  // unchanged, so a double-tap costs nothing while a real reversal earns its
  // own row in the log.
  async setDoNotKnock(
    organization: Organization,
    actorUserId: number,
    input: SetDoNotKnock,
  ): Promise<SetDoNotKnockResponse> {
    const personId = await this.personIdForTarget(
      organization.slug,
      input.stopTargetId,
    )

    await this.contactStatus.changeStatus({
      organizationSlug: organization.slug,
      personId,
      field: ContactStatusField.do_not_knock,
      toValue: input.value,
      source: ContactStatusSource.door_knock,
      actorUserId,
      // Nobody is born do-not-knock, so the seed is always `cleared`. Passing
      // it rather than null keeps a clear-on-an-unflagged-person a no-op
      // instead of logging a `null -> cleared` transition that never happened.
      fallbackFromValue: DoNotKnockStatus.cleared,
    })

    return {
      personId,
      doNotKnock: input.value === DoNotKnockStatus.active,
    }
  }

  // Resolving through the route -> turf -> filter chain is the authorization:
  // holding a stopTargetId proves nothing on its own, but a target that
  // resolves under the caller's org is one the caller was routed to.
  private async personIdForTarget(
    organizationSlug: string,
    stopTargetId: number,
  ): Promise<string> {
    const target = await this.findFirst({
      where: {
        id: stopTargetId,
        stop: {
          route: {
            turf: { voterFileFilter: { organizationSlug } },
          },
        },
      },
      select: { personId: true },
    })
    if (!target) {
      throw new NotFoundException('Stop target not found')
    }
    return target.personId
  }
}
