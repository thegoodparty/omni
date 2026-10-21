import {
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common'
import { ModuleRef } from '@nestjs/core'
import { addMinutes, getTime, isAfter, max } from 'date-fns'
import {
  answersNeeded,
  PANEL_MIN_MEMBERS_FOR_BALANCE,
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
  OutreachStatus,
  OutreachType,
  PollIndividualMessageSender,
  Prisma,
  PriorityAnswerCode,
  SynthesisRunStatus,
  SynthesisScope,
} from '../../generated/prisma'
import { createPrismaBase, MODELS } from '@/prisma/util/prisma.util'
import {
  ContactsService,
  type ContactsFilterResolutionInput,
} from '@/contacts/services/contacts.service'
import { doorTractFor } from '@/contacts/utils/civicPanelSteering.util'
import { MIN_CONFIRMED_FOR_SYNTHESIS } from '@/constituentFeedback/services/feedbackReport.service'
import type { PersonAnswer } from '@/peopleDb/databricks/districtCensusSql.util'
import {
  CENSUS_COMPOSITION_SOURCE,
  type CensusCompositionSource,
} from './censusComposition'
import { estimateMrp } from '../util/mrp.util'
import { PRIORITY_UNSENT_STATUSES } from '../util/priorityRespondents.util'
import {
  answerGroups,
  holdingBackTracts,
  mrpReadStatus,
  type MrpRead,
} from '../util/mrpReadStatus.util'
import type { WeightingCensus } from '../util/censusWeighting.util'

const CHANNEL_BY_TYPE: Partial<Record<OutreachType, PriorityResultsChannel>> = {
  [OutreachType.text]: 'text',
  [OutreachType.nativePhoneBanking]: 'phoneBanking',
  [OutreachType.nativeDoorKnocking]: 'doorKnocking',
  [OutreachType.socialMedia]: 'social',
}

// ~100m. Enough to see which blocks answered, not enough to find a house.
const roundCoordinate = (value: number): number =>
  Math.round(value * 1000) / 1000

const MRP_READ_CACHE_MINUTES = 15

const UNSENT_STATUSES = PRIORITY_UNSENT_STATUSES

// A mixed answer is half a yes; an answer that is no answer sits out.
const YES_SHARE: Record<PriorityAnswerCode, number | null> = {
  [PriorityAnswerCode.yes]: 1,
  [PriorityAnswerCode.no]: 0,
  [PriorityAnswerCode.mixed]: 0.5,
  [PriorityAnswerCode.not_an_answer]: null,
}

interface FollowUpState {
  next?: { scheduledLocalDate: string; texts: number }
  sent: boolean
}

interface SendRespondents {
  send: PriorityResultsSend
  respondentIds: string[]
}

// A priority's coded answers, one per person, and a key that changes when
// any of them does.
interface CodedAnswers {
  answers: PersonAnswer[]
  key: string
}

const NO_CODED_ANSWERS: CodedAnswers = { answers: [], key: 'none' }

@Injectable()
export class PriorityResultsService extends createPrismaBase(MODELS.Priority) {
  private readonly reads = new Map<string, { read: MrpRead; expiresAt: Date }>()

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
    const contacts = this.resolveContacts()
    const { points } = await contacts.pointsForPeople(ids, organization)
    const coded =
      (await this.codedAnswers(organizationSlug, [priorityId])).get(
        priorityId,
      ) ?? NO_CODED_ANSWERS
    const read = await this.mrpReadOf(organization, priorityId, coded)

    const { themes, summarizing } = await this.pooledThemes(
      organizationSlug,
      priorityId,
      ids.length,
    )

    return {
      priorityId,
      readStatus: {
        ...mrpReadStatus({ answers: ids.length, read }),
        ...this.outreachState(
          perSend.map(({ send }) => send),
          (await this.followUpsFor(organizationSlug, [priorityId])).get(
            priorityId,
          ),
        ),
      },
      sends: perSend.map(({ send }) => send),
      respondents: { total: ids.length, byChannel, joinedCivicPanel },
      themes,
      summarizing,
      points: points.map(({ lat, lng }) => ({
        lat: roundCoordinate(lat),
        lng: roundCoordinate(lng),
      })),
      groups: answerGroups(read),
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
    return statuses.get(priorityId) ?? mrpReadStatus({ answers: 0, read: null })
  }

  // Answers pooled per priority, the same people resultsFor counts, against
  // the district. The caller has already scoped the ids to the office.
  async readStatuses(
    organizationSlug: string,
    priorityIds: string[],
  ): Promise<Map<string, PriorityReadStatus>> {
    if (priorityIds.length === 0) return new Map()
    const organization = await this.client.organization.findUniqueOrThrow({
      where: { slug: organizationSlug },
    })
    const [sends, coded, followUps] = await Promise.all([
      this.sendsFor(organizationSlug, priorityIds),
      this.codedAnswers(organizationSlug, priorityIds),
      this.followUpsFor(organizationSlug, priorityIds),
    ])
    return new Map(
      await Promise.all(
        priorityIds.map(async (id): Promise<[string, PriorityReadStatus]> => {
          const people = [
            ...new Set(
              (sends.get(id) ?? []).flatMap((send) => send.respondentIds),
            ),
          ]
          const read = await this.mrpReadOf(
            organization,
            id,
            coded.get(id) ?? NO_CODED_ANSWERS,
          )
          return [
            id,
            {
              ...mrpReadStatus({ answers: people.length, read }),
              ...this.outreachState(
                (sends.get(id) ?? []).map(({ send }) => send),
                followUps.get(id),
              ),
            },
          ]
        }),
      ),
    )
  }

  // What has gone out on a priority: whether a check is out with residents
  // on any channel, and the state of its follow-up text.
  private outreachState(
    sends: PriorityResultsSend[],
    followUp: FollowUpState | undefined,
  ): Pick<PriorityReadStatus, 'checkOut' | 'followUp' | 'followUpSent'> {
    return {
      ...(sends.some((send) => send.channel !== 'social') && {
        checkOut: true,
      }),
      ...(followUp?.next && { followUp: followUp.next }),
      ...(followUp?.sent && { followUpSent: true }),
    }
  }

  // Each priority's follow-up text: the next one paid for (held `pending`
  // until its draw hands it off) and not sent yet, and whether one has gone
  // out.
  private async followUpsFor(
    organizationSlug: string,
    priorityIds: string[],
  ): Promise<Map<string, FollowUpState>> {
    const rows = await this.client.outreach.findMany({
      where: {
        organizationSlug,
        campaignId: null,
        priorityId: { in: priorityIds },
        roundOneOutreachId: { not: null },
        status: { notIn: UNSENT_STATUSES },
      },
      orderBy: { scheduledLocalDate: Prisma.SortOrder.asc },
      select: {
        priorityId: true,
        scheduledLocalDate: true,
        textCount: true,
        status: true,
      },
    })
    const byPriority = new Map<string, FollowUpState>()
    for (const row of rows) {
      if (row.priorityId === null) continue
      const state = byPriority.get(row.priorityId) ?? { sent: false }
      // A denied or failed follow-up never reached anyone but is closed: the
      // check gets no third text.
      if (
        row.status === OutreachStatus.in_progress ||
        row.status === OutreachStatus.completed ||
        row.status === OutreachStatus.denied ||
        row.status === OutreachStatus.failed
      ) {
        state.sent = true
      } else if (
        row.status === OutreachStatus.pending &&
        state.next === undefined &&
        row.scheduledLocalDate !== null &&
        row.textCount
      ) {
        state.next = {
          scheduledLocalDate: row.scheduledLocalDate,
          texts: row.textCount,
        }
      }
      byPriority.set(row.priorityId, state)
    }
    return byPriority
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
        status: { notIn: UNSENT_STATUSES },
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

  // The answers a good read of the district needs, which the civic panel
  // is sized to give. No district, or a read that fails, sizes for the
  // smallest major group.
  async districtAnswersNeeded(organization: Organization): Promise<number> {
    try {
      const district =
        await this.resolveContacts().resolveEligibleDistrict(organization)
      return (
        (await this.census.districtAnswersNeeded(district)) ?? answersNeeded()
      )
    } catch {
      return answersNeeded()
    }
  }

  // The district's census, for sizing a priority's first round of outreach.
  // No district, or a census read that fails, is null: the caller sizes
  // without it.
  async districtCensus(
    organization: Organization,
  ): Promise<WeightingCensus | null> {
    try {
      const district =
        await this.resolveContacts().resolveEligibleDistrict(organization)
      const inputs = await this.census.weightingInputs({
        ...district,
        personIds: [],
      })
      return inputs?.census ?? null
    } catch {
      return null
    }
  }

  // The one walkable area of `households` doors a priority's first round
  // knocks, picked as the civic panel plan picks its door step's: in the
  // tract the priority's answers trail most once there are enough of them
  // to say, else, or when that tract holds too few doors, across the
  // district.
  async roundOneDoorArea(
    organization: Organization,
    priorityId: string,
    criteria: ContactsFilterResolutionInput,
    households: number,
  ): Promise<{ lat: number; lng: number; personIds: string[] }[]> {
    const contacts = this.resolveContacts()
    const tract = await this.trailingTract(organization, priorityId)
    if (tract !== null) {
      const inTract = await contacts.walkableAreaWithin(
        organization,
        criteria,
        [],
        households,
        tract,
      )
      if (inTract.length >= households) return inTract
    }
    return contacts.walkableAreaWithin(organization, criteria, [], households)
  }

  private async trailingTract(
    organization: Organization,
    priorityId: string,
  ): Promise<string | null> {
    const people = [
      ...new Set(
        (
          (await this.sendsFor(organization.slug, [priorityId])).get(
            priorityId,
          ) ?? []
        ).flatMap((send) => send.respondentIds),
      ),
    ]
    if (people.length < PANEL_MIN_MEMBERS_FOR_BALANCE) return null
    const district =
      await this.resolveContacts().resolveEligibleDistrict(organization)
    const mix = await this.census.weightingInputs({
      ...district,
      personIds: people,
    })
    return mix ? doorTractFor(mix) : null
  }

  // The neighborhoods the model has too few answers from, or is unsure of,
  // for a list saved to hear from them: the same tracts the status names.
  // 404 on a priority another org holds.
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
    const coded =
      (await this.codedAnswers(organizationSlug, [priorityId])).get(
        priorityId,
      ) ?? NO_CODED_ANSWERS
    const read = await this.mrpReadOf(organization, priorityId, coded)
    if (read === null) {
      throw new ServiceUnavailableException('The district could not be read')
    }
    const district =
      await this.resolveContacts().resolveEligibleDistrict(organization)
    return this.census.areaOfTracts({
      ...district,
      tracts: holdingBackTracts(read),
    })
  }

  // The coded answers on the sends resultsFor counts, per priority. A
  // person who answered on more than one send counts once, their answers
  // averaged.
  private async codedAnswers(
    organizationSlug: string,
    priorityIds: string[],
  ): Promise<Map<string, CodedAnswers>> {
    const rows = await this.client.priorityAnswer.findMany({
      where: {
        organizationSlug,
        code: { not: PriorityAnswerCode.not_an_answer },
        outreach: {
          priorityId: { in: priorityIds },
          organizationSlug,
          campaignId: null,
          status: { notIn: UNSENT_STATUSES },
        },
      },
      select: {
        personId: true,
        code: true,
        codedAt: true,
        outreach: { select: { priorityId: true } },
      },
    })
    const byPriority = new Map<string, typeof rows>()
    for (const row of rows) {
      const { priorityId } = row.outreach
      if (priorityId === null) continue
      byPriority.set(priorityId, [...(byPriority.get(priorityId) ?? []), row])
    }
    return new Map(
      [...byPriority].map(([priorityId, answers]) => {
        const byPerson = new Map<string, number[]>()
        for (const { personId, code } of answers) {
          const yes = YES_SHARE[code]
          if (yes === null) continue
          byPerson.set(personId, [...(byPerson.get(personId) ?? []), yes])
        }
        const latest = max(answers.map(({ codedAt }) => codedAt))
        return [
          priorityId,
          {
            answers: [...byPerson].map(([personId, shares]) => ({
              personId,
              yes:
                shares.reduce((sum, share) => sum + share, 0) / shares.length,
            })),
            key: `${answers.length}:${getTime(latest)}`,
          },
        ]
      }),
    )
  }

  // Every Chief of Staff and priority turn reads the status, and a read is
  // a warehouse read and a model fit, so one is kept for a while per
  // priority and its coded answers: a new or recoded answer is a new key.
  // A failure is never kept, so the next read tries again.
  private async mrpReadOf(
    organization: Organization,
    priorityId: string,
    coded: CodedAnswers,
  ): Promise<MrpRead | null> {
    const key = `${organization.slug}:${priorityId}:${coded.key}`
    const now = new Date()
    const kept = this.reads.get(key)
    if (kept && isAfter(kept.expiresAt, now)) return kept.read
    // No district is a read with no census, like a failed one.
    const district = await this.resolveContacts()
      .resolveEligibleDistrict(organization)
      .catch(() => null)
    if (!district) return null
    const inputs = await this.census.mrpInputs({
      ...district,
      answers: coded.answers,
    })
    if (!inputs) return null
    const read: MrpRead = {
      result: estimateMrp(inputs.answers, inputs.frame, {}),
      raceNameable: inputs.raceNameable,
    }
    for (const [stale, entry] of this.reads) {
      if (!isAfter(entry.expiresAt, now)) this.reads.delete(stale)
    }
    this.reads.set(key, {
      read,
      expiresAt: addMinutes(now, MRP_READ_CACHE_MINUTES),
    })
    return read
  }

  // The latest completed pooled run's themes. A run in flight leaves the
  // previous themes up, the way an effort's report does. Summarizing also
  // covers the gap before the first run: enough answers, nothing completed
  // and nothing failed, since a send's run is requested after it commits.
  private async pooledThemes(
    organizationSlug: string,
    priorityId: string,
    answered: number,
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
    const firstPending =
      latest === null &&
      answered >= MIN_CONFIRMED_FOR_SYNTHESIS &&
      (await this.client.feedbackSynthesisRun.count({
        where: { ...scope, status: SynthesisRunStatus.failed },
      })) === 0
    return {
      summarizing: running > 0 || firstPending,
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
