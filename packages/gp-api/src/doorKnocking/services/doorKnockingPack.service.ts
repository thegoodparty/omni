import { Readable } from 'node:stream'
import { Injectable } from '@nestjs/common'
import { DoorKnockingPackRequest } from '@goodparty_org/contracts'
import { createPrismaBase, MODELS } from '@/prisma/util/prisma.util'
import { ContactsService } from '@/contacts/services/contacts.service'
import { Organization, Prisma } from '../../generated/prisma'
import { DoorKnockingPeopleApiService } from './doorKnockingPeopleApi.service'
import { deriveKnockStatus } from '../utils/knockStatus.util'
import { PACK_BUILD_FAILED_EVENT, streamPack } from '../utils/packStream.util'

@Injectable()
export class DoorKnockingPackService extends createPrismaBase(
  MODELS.ContactInteractionDoorKnock,
) {
  constructor(
    private readonly peopleApi: DoorKnockingPeopleApiService,
    private readonly contacts: ContactsService,
  ) {
    super()
  }

  // Returns immediately with a live stream rather than a resolved buffer: the
  // knock read and the district scan below both happen after the response has
  // already been committed, so the connection is never idle waiting on them.
  stream(organization: Organization): Readable {
    return streamPack({
      build: (signal) => this.build(organization, signal),
      onFailure: (err) =>
        this.logger.error(
          {
            event: PACK_BUILD_FAILED_EVENT,
            organizationSlug: organization.slug,
            err,
          },
          'door-knocking pack build failed after the response had started',
        ),
    })
  }

  // The pack is a pass-through payload: the people-db pack builder encodes
  // the whole binary (including the canvassStatus plane, from the statuses
  // shipped in the request), so this service never patches bytes — it only
  // knows the org's knock history.
  async build(
    organization: Organization,
    signal?: AbortSignal,
  ): Promise<Buffer> {
    const districtId =
      await this.contacts.resolveEligibleDistrictId(organization)

    const interactions = await this.findMany({
      where: { organizationSlug: organization.slug },
      orderBy: [
        { occurredAt: Prisma.SortOrder.desc },
        { id: Prisma.SortOrder.desc },
      ],
      // Mirrors the contract's knockStatuses cap. Newest-first ordering
      // means truncation (absurd knock volume) drops the OLDEST rows, and a
      // dropped person just renders as unknown on the map.
      take: 200_000,
      select: { personId: true, outcome: true, supportAnswer: true },
    })
    const knockStatuses: DoorKnockingPackRequest['knockStatuses'] = []
    const seen = new Set<string>()
    for (const interaction of interactions) {
      if (seen.has(interaction.personId)) continue
      seen.add(interaction.personId)
      knockStatuses.push({
        personId: interaction.personId,
        status: deriveKnockStatus(interaction),
      })
    }

    return this.peopleApi.pack({ districtId, knockStatuses }, signal)
  }
}
