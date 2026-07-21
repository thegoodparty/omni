import { Injectable } from '@nestjs/common'
import { DoorKnockingPackRequest } from '@goodparty_org/contracts'
import { createPrismaBase, MODELS } from '@/prisma/util/prisma.util'
import { ContactsService } from '@/contacts/services/contacts.service'
import { Organization, Prisma } from '../../generated/prisma'
import { DoorKnockingPeopleApiService } from './doorKnockingPeopleApi.service'
import { deriveKnockStatus } from '../utils/knockStatus.util'

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

  // The pack is a pass-through payload: people-api encodes the whole binary
  // (including the canvassStatus plane, from the statuses shipped in the
  // request), so gp-api never patches bytes — it only knows the org's knock
  // history.
  async build(organization: Organization): Promise<Buffer> {
    const districtId =
      await this.contacts.resolveEligibleDistrictId(organization)

    const interactions = await this.findMany({
      where: { organizationSlug: organization.slug },
      orderBy: [
        { occurredAt: Prisma.SortOrder.desc },
        { id: Prisma.SortOrder.desc },
      ],
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

    return this.peopleApi.pack({ districtId, knockStatuses })
  }
}
