import { Inject, Injectable, NotFoundException } from '@nestjs/common'
import { ModuleRef } from '@nestjs/core'
import {
  MIN_RESPONDENTS_FOR_REPRESENTATION,
  type GeoJsonShape,
  type PriorityReadStatus,
  type PriorityResults,
  type PriorityResultsChannel,
  type PriorityResultsSend,
  type PriorityTheme,
} from '@goodparty_org/contracts'
import {
  ContactStatusField,
  ElectedOffice,
  Organization,
  Outreach,
  OutreachType,
  PollIndividualMessageSender,
  Prisma,
  SynthesisRunStatus,
  SynthesisScope,
} from '../../generated/prisma'
import { createPrismaBase, MODELS } from '@/prisma/util/prisma.util'
import { ContactsService } from '@/contacts/services/contacts.service'
import {
  CENSUS_COMPOSITION_SOURCE,
  representationFrom,
  type CensusCompositionSource,
  type CensusWeighting,
} from './censusComposition'
import {
  minAnswersForStatus,
  priorityReadStatus,
} from '../util/priorityReadStatus.util'

const CHANNEL_BY_TYPE: Partial<Record<OutreachType, PriorityResultsChannel>> = {
  [OutreachType.text]: 'text',
  [OutreachType.nativePhoneBanking]: 'phoneBanking',
  [OutreachType.nativeDoorKnocking]: 'doorKnocking',
  [OutreachType.socialMedia]: 'social',
}

// ~100m. Enough to see which blocks answered, not enough to find a house.
const roundCoordinate = (value: number): number =>
  Math.round(value * 1000) / 1000

const WEIGHTING_CACHE_MS = 15 * 60 * 1000

interface SendRespondents {
  send: PriorityResultsSend
  respondentIds: string[]
}

@Injectable()
export class PriorityResultsService extends createPrismaBase(MODELS.Priority) {
  private readonly weightings = new Map<
    string,
    { weighting: CensusWeighting; expiresAt: number }
  >()

  constructor(
    private readonly moduleRef: ModuleRef,
    @Inject(CENSUS_COMPOSITION_SOURCE)
    private readonly census: CensusCompositionSource,
  ) {
    super()
  }

  async resultsFor(
    electedOffice: ElectedOffice,
    priorityId: string,
  ): Promise<PriorityResults> {
    await this.assertOwned(electedOffice, priorityId)

    const organizationSlug = electedOffice.organizationSlug
    const perSend =
      (await this.sendsFor(organizationSlug, [priorityId])).get(priorityId) ??
      []

    const byChannelPeople = {
      text: new Set<string>(),
      phoneBanking: new Set<string>(),
      doorKnocking: new Set<string>(),
    }
    const respondentIds = new Set<string>()
    for (const { send, respondentIds: ids } of perSend) {
      for (const id of ids) {
        respondentIds.add(id)
        if (send.channel !== 'social') byChannelPeople[send.channel].add(id)
      }
    }
    const byChannel = {
      text: byChannelPeople.text.size,
      phoneBanking: byChannelPeople.phoneBanking.size,
      doorKnocking: byChannelPeople.doorKnocking.size,
    }
    const ids = [...respondentIds]

    const joinedCivicPanel =
      ids.length === 0
        ? 0
        : await this.client.contactCurrentStatus.count({
            where: {
              organizationSlug,
              field: ContactStatusField.civic_panel,
              value: 'member',
              personId: { in: ids },
            },
          })

    const organization = await this.client.organization.findUniqueOrThrow({
      where: { slug: organizationSlug },
    })
    const population = await this.districtPopulation(organization)
    const contacts = this.resolveContacts()
    const { points } = await contacts.pointsForPeople(ids, organization)
    const weighting = await this.weightingOf(
      organization,
      priorityId,
      ids,
      population,
    )

    const representation =
      ids.length >= MIN_RESPONDENTS_FOR_REPRESENTATION
        ? representationFrom(
            await this.census.compose({
              ...(await contacts.resolveEligibleDistrict(organization)),
              personIds: ids,
            }),
            ids.length,
            weighting,
          )
        : null

    const { themes, summarizing } = await this.pooledThemes(
      organizationSlug,
      priorityId,
    )

    return {
      priorityId,
      readStatus: priorityReadStatus({
        answers: ids.length,
        population,
        weighting: weighting?.read ?? null,
      }),
      sends: perSend.map(({ send }) => send),
      respondents: { total: ids.length, byChannel, joinedCivicPanel },
      themes,
      summarizing,
      points: points.map(({ lat, lng }) => ({
        lat: roundCoordinate(lat),
        lng: roundCoordinate(lng),
      })),
      representation,
    }
  }

  async readStatusFor(
    electedOffice: ElectedOffice,
    priorityId: string,
  ): Promise<PriorityReadStatus> {
    await this.assertOwned(electedOffice, priorityId)
    const statuses = await this.readStatuses(electedOffice.organizationSlug, [
      priorityId,
    ])
    return (
      statuses.get(priorityId) ??
      priorityReadStatus({ answers: 0, population: null, weighting: null })
    )
  }

  // Answers pooled per priority, the same people resultsFor counts, against
  // the district. The caller has already scoped the ids to the office. A
  // caller that already read the population passes it, so a turn reads it
  // once.
  async readStatuses(
    organizationSlug: string,
    priorityIds: string[],
    knownPopulation?: number | null,
  ): Promise<Map<string, PriorityReadStatus>> {
    if (priorityIds.length === 0) return new Map()
    const organization = await this.client.organization.findUniqueOrThrow({
      where: { slug: organizationSlug },
    })
    const [sends, population] = await Promise.all([
      this.sendsFor(organizationSlug, priorityIds),
      knownPopulation !== undefined
        ? Promise.resolve(knownPopulation)
        : this.districtPopulation(organization),
    ])
    return new Map(
      await Promise.all(
        priorityIds.map(async (id): Promise<[string, PriorityReadStatus]> => {
          const people = [
            ...new Set(
              (sends.get(id) ?? []).flatMap((send) => send.respondentIds),
            ),
          ]
          const weighting = await this.weightingOf(
            organization,
            id,
            people,
            population,
          )
          return [
            id,
            priorityReadStatus({
              answers: people.length,
              population,
              weighting: weighting?.read ?? null,
            }),
          ]
        }),
      ),
    )
  }

  private async assertOwned(
    electedOffice: ElectedOffice,
    priorityId: string,
  ): Promise<void> {
    const priority = await this.model.findFirst({
      where: { id: priorityId, electedOfficeId: electedOffice.id },
      select: { id: true },
    })
    if (!priority) throw new NotFoundException('Priority not found')
  }

  private async sendsFor(
    organizationSlug: string,
    priorityIds: string[],
  ): Promise<Map<string, SendRespondents[]>> {
    const outreaches = await this.client.outreach.findMany({
      where: {
        priorityId: { in: priorityIds },
        organizationSlug,
        campaignId: null,
        status: { notIn: ['pending_payment', 'draft', 'canceled'] },
      },
      orderBy: { createdAt: 'asc' },
    })
    const perSend = await Promise.all(
      outreaches.flatMap((outreach) => {
        const channel = CHANNEL_BY_TYPE[outreach.outreachType]
        const { priorityId } = outreach
        return channel && priorityId !== null
          ? [
              this.respondentsFor(outreach, channel).then((send) => ({
                priorityId,
                send,
              })),
            ]
          : []
      }),
    )
    const byPriority = new Map<string, SendRespondents[]>()
    for (const { priorityId, send } of perSend) {
      byPriority.set(priorityId, [...(byPriority.get(priorityId) ?? []), send])
    }
    return byPriority
  }

  // No district, or a census read that fails, is an unknown population:
  // answersNeeded falls back to its uncorrected figure.
  async districtPopulation(organization: Organization): Promise<number | null> {
    try {
      const district =
        await this.resolveContacts().resolveEligibleDistrict(organization)
      return await this.census.population(district)
    } catch {
      return null
    }
  }

  // The parts of the district a priority's answers have barely reached, for
  // a list saved to hear from them. 404 on a priority another org holds.
  async unreachedAreaFor(
    organizationSlug: string,
    priorityId: string,
  ): Promise<GeoJsonShape | null> {
    const priority = await this.model.findFirst({
      where: { id: priorityId, electedOffice: { organizationSlug } },
      select: { id: true },
    })
    if (!priority) throw new NotFoundException('Priority not found')
    const organization = await this.client.organization.findUniqueOrThrow({
      where: { slug: organizationSlug },
    })
    const sends = await this.sendsFor(organizationSlug, [priorityId])
    const people = [
      ...new Set(
        (sends.get(priorityId) ?? []).flatMap((send) => send.respondentIds),
      ),
    ]
    const district =
      await this.resolveContacts().resolveEligibleDistrict(organization)
    return this.census.unreachedArea({ ...district, personIds: people })
  }

  // Below the answers a status needs, there is nothing to weigh yet, so
  // the warehouse is not asked. Every Chief of Staff and priority turn reads
  // the status, and a weighting is three warehouse reads, so one is kept for
  // a while per priority and answer count: a new answer is a new key. A
  // failure is never kept, so the next read tries again.
  private async weightingOf(
    organization: Organization,
    priorityId: string,
    personIds: string[],
    population: number | null,
  ): Promise<CensusWeighting | null> {
    if (personIds.length < minAnswersForStatus(population)) return null
    const key = `${organization.slug}:${priorityId}:${personIds.length}`
    const now = Date.now()
    const kept = this.weightings.get(key)
    if (kept && kept.expiresAt > now) return kept.weighting
    try {
      const district =
        await this.resolveContacts().resolveEligibleDistrict(organization)
      const weighting = await this.census.weighting({ ...district, personIds })
      if (weighting) {
        for (const [stale, entry] of this.weightings) {
          if (entry.expiresAt <= now) this.weightings.delete(stale)
        }
        this.weightings.set(key, {
          weighting,
          expiresAt: now + WEIGHTING_CACHE_MS,
        })
      }
      return weighting
    } catch {
      return null
    }
  }

  // The latest completed pooled run's themes. A run in flight leaves the
  // previous themes up, the way an effort's report does.
  private async pooledThemes(
    organizationSlug: string,
    priorityId: string,
  ): Promise<{ themes: PriorityTheme[]; summarizing: boolean }> {
    const scope = {
      organizationSlug,
      priorityId,
      scope: SynthesisScope.priority,
    }
    const [latest, running] = await Promise.all([
      this.client.feedbackSynthesisRun.findFirst({
        where: { ...scope, status: SynthesisRunStatus.completed },
        orderBy: { completedAt: Prisma.SortOrder.desc },
        select: {
          themes: {
            orderBy: { rank: Prisma.SortOrder.asc },
            select: {
              id: true,
              title: true,
              summary: true,
              members: {
                where: {
                  OR: [
                    { feedback: { confirmedAt: { not: null } } },
                    { textReplyId: { not: null } },
                  ],
                },
                select: {
                  feedback: { select: { personId: true } },
                  textReply: { select: { personId: true } },
                },
              },
            },
          },
        },
      }),
      this.client.feedbackSynthesisRun.count({
        where: { ...scope, status: SynthesisRunStatus.running },
      }),
    ])
    return {
      summarizing: running > 0,
      // Same rule as the agent's read (themesWithPeople in
      // priorityFlowOutreach.service.ts): confirmed notes and replies,
      // distinct people, empty themes left out.
      themes: (latest?.themes ?? []).flatMap((theme) => {
        const people = new Set(
          theme.members.flatMap((member) => {
            const personId =
              member.feedback?.personId ?? member.textReply?.personId
            return personId === undefined ? [] : [personId]
          }),
        ).size
        return people === 0
          ? []
          : [
              {
                id: theme.id,
                title: theme.title,
                summary: theme.summary,
                people,
              },
            ]
      }),
    }
  }

  // Resolved lazily: importing ContactsModule here closes the module cycle
  // through Campaigns that organizationTeam.service.ts describes.
  private resolveContacts(): ContactsService {
    return this.moduleRef.get(ContactsService, { strict: false })
  }

  private async respondentsFor(
    outreach: Outreach,
    channel: PriorityResultsChannel,
  ): Promise<SendRespondents> {
    const base = {
      outreachId: outreach.id,
      name: outreach.name,
      channel,
      date: (outreach.date ?? outreach.createdAt).toISOString(),
    }
    if (channel === 'text') {
      const reached = await this.client.contactInteractionText.count({
        where: { outreachId: outreach.id },
      })
      // Heard means they said something: a reply that was only STOP is an
      // opt-out, not an answer on the priority.
      const replies = await this.client.pollIndividualMessage.findMany({
        where: {
          outreachId: outreach.id,
          sender: PollIndividualMessageSender.CONSTITUENT,
          NOT: { isOptOut: true },
        },
        select: { personId: true },
        distinct: ['personId'],
      })
      const responded = replies.map((reply) => reply.personId)
      return {
        send: { ...base, reached, responded: responded.length },
        respondentIds: responded,
      }
    }
    if (channel === 'phoneBanking' && outreach.phoneBankingListId !== null) {
      const rows = await this.client.contactInteractionPhoneBanking.findMany({
        where: { phoneBankingListId: outreach.phoneBankingListId },
        select: { personId: true, outcome: true },
      })
      const reached = new Set(rows.map((row) => row.personId))
      const responded = [
        ...new Set(
          rows
            .filter((row) => row.outcome === 'answered')
            .map((row) => row.personId),
        ),
      ]
      return {
        send: { ...base, reached: reached.size, responded: responded.length },
        respondentIds: responded,
      }
    }
    if (channel === 'doorKnocking') {
      // The knock's own envelope, never the turf's stops: a person can sit
      // in two turfs, and a later CRM knock belongs to no walk.
      const rows = await this.client.contactInteractionDoorKnock.findMany({
        where: {
          organizationSlug: outreach.organizationSlug ?? undefined,
          outreachId: outreach.id,
        },
        select: { personId: true, outcome: true },
      })
      const reached = new Set(rows.map((row) => row.personId))
      const responded = [
        ...new Set(
          rows
            .filter((row) => row.outcome === 'answered')
            .map((row) => row.personId),
        ),
      ]
      return {
        send: { ...base, reached: reached.size, responded: responded.length },
        respondentIds: responded,
      }
    }
    return {
      send: { ...base, reached: null, responded: null },
      respondentIds: [],
    }
  }
}
