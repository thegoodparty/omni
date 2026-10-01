import { Readable } from 'node:stream'
import { Injectable } from '@nestjs/common'
import {
  DoorKnockingPackRequest,
  PACK_CONTACTS_MADE_MAX,
  PACK_EXCLUDED_PEOPLE_MAX,
} from '@goodparty_org/contracts'
import { createPrismaBase, MODELS } from '@/prisma/util/prisma.util'
import { ContactsService } from '@/contacts/services/contacts.service'
import { ContactsMadeResolutionService } from '@/contactInteraction/services/contactsMadeResolution.service'
import { ContactStatusService } from '@/contactInteraction/services/contactStatus.service'
import {
  ContactStatusField,
  DoNotKnockStatus,
  NotAVoterStatus,
  Organization,
  Prisma,
} from '../../generated/prisma'
import { DoorKnockingPeopleApiService } from './doorKnockingPeopleApi.service'
import {
  deriveKnockStatus,
  firmestAnswerPerPerson,
} from '../utils/knockStatus.util'
import { PACK_BUILD_FAILED_EVENT, streamPack } from '../utils/packStream.util'

@Injectable()
export class DoorKnockingPackService extends createPrismaBase(
  MODELS.ContactInteractionDoorKnock,
) {
  constructor(
    private readonly peopleApi: DoorKnockingPeopleApiService,
    private readonly contacts: ContactsService,
    private readonly contactsMade: ContactsMadeResolutionService,
    private readonly contactStatus: ContactStatusService,
  ) {
    super()
  }

  // Resolves the district (and with it the voter-data eligibility gate) BEFORE
  // handing back a stream, then returns immediately: the knock reads and the
  // district scan still happen after the response has been committed, so the
  // connection is never idle waiting on the expensive part.
  //
  // The resolve is awaited out here because an organization with no district is
  // not a failed build — it is a request that should never have been answered,
  // and every other voter-data read answers it with a 4xx the client can act
  // on. Once the envelope's first bytes are out the status line is 200 forever,
  // so a resolve left inside the build could only be reported as a map that
  // died halfway through being drawn, which pages the on-call team for an
  // organization that was simply never eligible. Measured in prod (trace
  // 9cdb3d0a4b2e0bc573129f499233c554) this costs ~32ms of idle socket — two
  // election-api position reads plus two small Postgres reads — against the
  // gateway's 120s idle timeout. The gap the envelope exists to remove is the
  // district scan, which is 12.7-43.5s.
  async stream(organization: Organization): Promise<Readable> {
    const districtId =
      await this.contacts.resolveEligibleDistrictId(organization)

    return streamPack({
      build: (signal) => this.build(organization, districtId, signal),
      // `districtId` is always present here now, and that is the point: the
      // scan's cost is a property of the district and of nothing else, so the
      // same org fails every time on a district too large for the current query
      // plan and succeeds immediately after it is reassigned. Without this
      // field that pattern is invisible and each firing reads as a fresh
      // unexplained failure.
      onFailure: (err, elapsedMs) =>
        this.logger.error(
          {
            event: PACK_BUILD_FAILED_EVENT,
            organizationSlug: organization.slug,
            districtId,
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
  //
  // `districtId` is a parameter rather than something this resolves: the
  // resolve is also the eligibility check, and it belongs in front of the
  // response head (see `stream`), so an ineligible organization never reaches
  // this method and never has its interaction history read at all.
  async build(
    organization: Organization,
    districtId: string,
    signal?: AbortSignal,
  ): Promise<Buffer> {
    // Concurrent: these two are independent of each other, and both are small
    // next to the district scan they precede.
    const [buckets, interactions, doNotKnockIds, notAVoterIds] =
      await Promise.all([
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
        // ADR 0007 and ADR 0008, read exactly as `doorKnockingPreview` and
        // `doorKnockingCreate` read them — same fields, same values, deduped
        // below into one list. Every server-side evaluation already drops
        // these people; the map was the last surface still drawing them.
        this.contactStatus.personIdsByFieldValue(
          organization.slug,
          ContactStatusField.do_not_knock,
          [DoNotKnockStatus.active],
        ),
        this.contactStatus.personIdsByFieldValue(
          organization.slug,
          ContactStatusField.not_a_voter,
          [NotAVoterStatus.moved, NotAVoterStatus.deceased],
        ),
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

    // Deduped because a person told "don't come back" who also moved is two
    // facts about one door, which is the same sentence `doorKnockingCreate`
    // carries over its own version of this.
    //
    // Over the cap becomes ABSENT rather than truncated: a partial exclusion
    // list draws some of the people who asked not to be knocked, and if we
    // cannot answer completely the honest thing is not to answer. These sets
    // are far smaller than the cap in practice.
    const excluded = [...new Set([...doNotKnockIds, ...notAVoterIds])]
    const excludedPersonIds =
      excluded.length > PACK_EXCLUDED_PEOPLE_MAX ? undefined : excluded

    return this.peopleApi.pack(
      { districtId, knockStatuses, contactsMade, excludedPersonIds },
      signal,
    )
  }
}
