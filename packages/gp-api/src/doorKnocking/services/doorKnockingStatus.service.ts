import { Injectable } from '@nestjs/common'
import {
  DoorKnockStatus,
  NotAVoterReason,
  NotAVoterReasonSchema,
} from '@goodparty_org/contracts'
import { createPrismaBase, MODELS } from '@/prisma/util/prisma.util'
import { ContactStatusService } from '@/contactInteraction/services/contactStatus.service'
import {
  ContactStatusField,
  DoNotKnockStatus,
  Prisma,
} from '../../generated/prisma'
import {
  deriveKnockStatus,
  overrideToKnockStatus,
} from '../utils/knockStatus.util'

// The three live CRM reads every door-knocking surface layers over a frozen
// route: the effective knock status, and the two suppression flags. They were
// private to `DoorKnockingServeService` while the walk was the only consumer;
// the rail's per-list counts are the second, and they have to agree with the
// detail sheet down to the last person. A second derivation would be a second
// answer to "has this door been logged?", and a candidate holding two of them
// has no way to tell which is lying — so this is one implementation both call
// rather than two that happen to match today.
//
// All three join on the (organizationSlug, personId) pair. There is no FK from
// `DoorKnockingStopTarget` to either table, which is also why none of this can
// be expressed as a Prisma `_count`.
@Injectable()
export class DoorKnockingStatusService extends createPrismaBase(
  MODELS.ContactInteractionDoorKnock,
) {
  constructor(private readonly contactStatus: ContactStatusService) {
    super()
  }

  // Effective status per person, org-wide: a manual override wins, otherwise
  // the interaction history derives one. Both halves follow
  // SupportStatusService's rules so a person reads the same at the door as in
  // Contacts — the two used to disagree, and a candidate looking at one while
  // holding the other has no way to tell which is lying.
  //
  // Served by the CRM table's (organizationSlug, personId, occurredAt) index;
  // rows per person are bounded by real knock history, so the reduce stays
  // cheap.
  async latestKnockStatuses(
    organizationSlug: string,
    personIds: string[],
  ): Promise<Map<string, DoorKnockStatus>> {
    if (personIds.length === 0) return new Map()
    const [interactions, overrides] = await Promise.all([
      this.model.findMany({
        where: { organizationSlug, personId: { in: personIds } },
        orderBy: [
          { occurredAt: Prisma.SortOrder.desc },
          { id: Prisma.SortOrder.desc },
        ],
        select: { personId: true, outcome: true, supportAnswer: true },
      }),
      this.contactStatus.currentStatusForPeople(
        organizationSlug,
        ContactStatusField.support_status,
        personIds,
      ),
    ])

    // Rows arrive newest-first, so the first row per person is the latest and
    // the first answer-bearing one is the latest answer. Preferring the answer
    // mirrors derivedStatusSql's `(support_answer IS NOT NULL) DESC` ordering:
    // a later "not home" is a failed re-attempt, not a retraction of the
    // support they already told us about.
    const latest = new Map<string, (typeof interactions)[number]>()
    const latestAnswered = new Map<string, (typeof interactions)[number]>()
    for (const interaction of interactions) {
      if (!latest.has(interaction.personId)) {
        latest.set(interaction.personId, interaction)
      }
      if (
        interaction.supportAnswer !== null &&
        !latestAnswered.has(interaction.personId)
      ) {
        latestAnswered.set(interaction.personId, interaction)
      }
    }

    const statusByPersonId = new Map<string, DoorKnockStatus>()
    for (const personId of new Set(personIds)) {
      const overridden = overrideToKnockStatus(overrides.get(personId))
      if (overridden) {
        statusByPersonId.set(personId, overridden)
        continue
      }
      const interaction = latestAnswered.get(personId) ?? latest.get(personId)
      if (interaction) {
        statusByPersonId.set(personId, deriveKnockStatus(interaction))
      }
    }
    return statusByPersonId
  }

  // ADR 0007. Turf evaluation keeps flagged people out of new routes, but it
  // cannot reach into a route already frozen — so the flag is read live here,
  // scoped to the caller's targets rather than the org's whole flagged set.
  async doNotKnockPersonIds(
    organizationSlug: string,
    personIds: string[],
  ): Promise<Set<string>> {
    if (personIds.length === 0) return new Set()
    const byPersonId = await this.contactStatus.currentStatusForPeople(
      organizationSlug,
      ContactStatusField.do_not_knock,
      personIds,
    )
    return new Set(
      [...byPersonId.entries()]
        .filter(([, value]) => value === DoNotKnockStatus.active)
        .map(([personId]) => personId),
    )
  }

  // ADR 0008. Same live read as the do-not-knock flag above and for the same
  // reason: the route in someone's hand was frozen before this was recorded.
  // `cleared` (and any value a future writer adds) parses out, so only a real
  // reason reaches a caller.
  async notAVoterReasons(
    organizationSlug: string,
    personIds: string[],
  ): Promise<Map<string, NotAVoterReason>> {
    if (personIds.length === 0) return new Map()
    const byPersonId = await this.contactStatus.currentStatusForPeople(
      organizationSlug,
      ContactStatusField.not_a_voter,
      personIds,
    )
    return new Map(
      [...byPersonId.entries()].flatMap(([personId, value]) => {
        const reason = NotAVoterReasonSchema.safeParse(value)
        return reason.success ? [[personId, reason.data] as const] : []
      }),
    )
  }
}
