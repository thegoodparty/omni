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
import {
  deriveKnockStatus,
  firmestAnswerPerPerson,
} from '../utils/knockStatus.util'
import { PACK_BUILD_FAILED_EVENT, streamPack } from '../utils/packStream.util'

/**
 * What a build learns that its caller did not already know.
 *
 * Exists so the failure log can name the district without the resolve moving
 * out of the build. Deliberately not a return value: the build's failure path
 * is a rejection, and a rejection carries no partial result.
 */
type PackBuildContext = { districtId?: string }

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
    // The district is resolved inside the build (it has to be — resolving it
    // is a query, and doing it here would put back the idle gap the envelope
    // exists to remove), but the failure log is written out here. So the build
    // reports it back through this, and `districtId` is absent in the log when
    // the resolve itself was what failed — which is true, and is a different
    // failure from a scan that timed out.
    //
    // It is in the log because the scan's cost is a property of the district
    // and of nothing else: the same org fails every time on a district too
    // large for the current query plan, and succeeds immediately after it is
    // reassigned. Without this field that pattern is invisible, and each
    // firing reads as a fresh unexplained failure.
    const context: PackBuildContext = {}

    return streamPack({
      build: (signal) => this.build(organization, signal, context),
      onFailure: (err, elapsedMs) =>
        this.logger.error(
          {
            event: PACK_BUILD_FAILED_EVENT,
            organizationSlug: organization.slug,
            districtId: context.districtId,
            elapsedMs,
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
    context?: PackBuildContext,
  ): Promise<Buffer> {
    const districtId =
      await this.contacts.resolveEligibleDistrictId(organization)
    // Recorded before the two reads below, so a failure in either of them
    // still reports the district it was reading for.
    if (context) context.districtId = districtId

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
    // Literally the same selection `DoorKnockingStatusService` makes, because
    // this map colours the pin and that one colours the row a tap later: a
    // person deriving differently here would show `not_home` on the map and
    // `needs_follow_up` in the walk — one door, two answers, and no way for the
    // canvasser to tell which is lying. It was first-seen once, and a
    // paraphrase of the other service's loop after that; now it is the
    // function itself.
    const knockStatuses: DoorKnockingPackRequest['knockStatuses'] = []
    for (const [personId, interaction] of firmestAnswerPerPerson(
      interactions,
    )) {
      knockStatuses.push({
        personId,
        status: deriveKnockStatus(interaction),
      })
    }

    return this.peopleApi.pack(
      { districtId, knockStatuses, contactsMade },
      signal,
    )
  }
}
