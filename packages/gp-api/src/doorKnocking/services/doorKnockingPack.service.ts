import { Readable } from 'node:stream'
import { Injectable } from '@nestjs/common'
import {
  DoorKnockingPackRequest,
  PACK_CONTACTS_MADE_MAX,
} from '@goodparty_org/contracts'
import { createPrismaBase, MODELS } from '@/prisma/util/prisma.util'
import { ContactsService } from '@/contacts/services/contacts.service'
import { ContactsMadeResolutionService } from '@/contactInteraction/services/contactsMadeResolution.service'
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
    private readonly contactsMade: ContactsMadeResolutionService,
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
  // the whole binary (including the two campaign-specific planes, from the
  // arrays shipped in the request), so this service never patches bytes — it
  // only knows the org's own outreach history.
  //
  // Both plane inputs are read HERE rather than inside the people-db build,
  // and that separation is load-bearing: the district scan stays a pure
  // function of `districtId`, which is the property a per-district pack cache
  // would rest on (docs/perf/voter-pack-headroom.md). A per-organization read
  // that moved into `VoterPackService` would take it away.
  async build(
    organization: Organization,
    signal?: AbortSignal,
  ): Promise<Buffer> {
    const districtId =
      await this.contacts.resolveEligibleDistrictId(organization)

    // Concurrent, but only after the district resolve: that call is also the
    // eligibility check, and an ineligible organization should not have had
    // its interaction history read at all. These two are independent of each
    // other, and both are small next to the district scan they precede.
    const [buckets, interactions] = await Promise.all([
      this.contactsMade.contactsMadeBuckets(
        organization.slug,
        PACK_CONTACTS_MADE_MAX,
      ),
      this.findMany({
        where: { organizationSlug: organization.slug },
        orderBy: [
          { occurredAt: Prisma.SortOrder.desc },
          { id: Prisma.SortOrder.desc },
        ],
        // Mirrors the contract's knockStatuses cap. Newest-first ordering
        // means truncation (absurd knock volume) drops the OLDEST rows, and a
        // dropped person just renders as unknown on the map.
        take: 200_000,
        select: {
          personId: true,
          outcome: true,
          supportAnswer: true,
          followUp: true,
        },
      }),
    ])
    // `null` (over the cap) becomes absent, not empty — the contract's two
    // states differ, and empty would assert nobody has been contacted.
    const contactsMade = buckets ?? undefined
    // The same two-map preference `DoorKnockingStatusService.latestKnockStatuses`
    // applies, and for the same reason: rows arrive newest-first, so the first
    // row per person is the latest and the first answer-bearing one is the
    // latest answer. A later "not home" is a failed re-attempt, not a
    // retraction of the answer already given.
    //
    // This map colours the pin and that one colours the row a tap later, so a
    // person reading first-seen here would show `not_home` on the map and
    // `needs_follow_up` in the walk — one door, two answers, and no way for the
    // canvasser to tell which is lying. It used to be first-seen, which was the
    // same divergence on `supportAnswer`; the Serve answer is what made it
    // reachable in a single evening, since returning to a door is the whole
    // point of a follow-up.
    const knockStatuses: DoorKnockingPackRequest['knockStatuses'] = []
    const latest = new Map<string, (typeof interactions)[number]>()
    const latestAnswered = new Map<string, (typeof interactions)[number]>()
    for (const interaction of interactions) {
      if (!latest.has(interaction.personId)) {
        latest.set(interaction.personId, interaction)
      }
      if (
        (interaction.supportAnswer !== null || interaction.followUp !== null) &&
        !latestAnswered.has(interaction.personId)
      ) {
        latestAnswered.set(interaction.personId, interaction)
      }
    }
    for (const personId of latest.keys()) {
      knockStatuses.push({
        personId,
        status: deriveKnockStatus(
          latestAnswered.get(personId) ?? latest.get(personId)!,
        ),
      })
    }

    return this.peopleApi.pack(
      { districtId, knockStatuses, contactsMade },
      signal,
    )
  }
}
