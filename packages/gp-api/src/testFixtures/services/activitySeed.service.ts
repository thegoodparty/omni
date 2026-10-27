import { randomUUID } from 'node:crypto'
import {
  Inject,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common'
import { addMinutes, subDays, subMinutes } from 'date-fns'
import {
  CIVIC_PANEL_JOIN_LINE,
  type GeoJsonPolygon,
  type Person,
  type SeedTestFixtureActivityRequest,
  type SeedTestFixtureActivityResponse,
} from '@goodparty_org/contracts'
import {
  CivicPanelStatus,
  ConstituentFeedbackChannel,
  ContactStatusField,
  DoorKnockOutcome,
  DoorKnockingMode,
  DoorKnockingPurpose,
  FollowUpAnswer,
  OrganizationRole,
  OutreachStatus,
  OutreachType,
  PhoneBankCallOutcome,
  PhoneBankingPurpose,
  PollIndividualMessageSender,
  PriorityAnswerSource,
  PrioritySource,
  SupportAnswer,
  WillVoteAnswer,
  type Organization,
} from '@/generated/prisma'
import { ContactInteractionDoorKnockService } from '@/contactInteraction/services/contactInteractionDoorKnock.service'
import { ContactInteractionRobocallService } from '@/contactInteraction/services/contactInteractionRobocall.service'
import { ContactInteractionTextService } from '@/contactInteraction/services/contactInteractionText.service'
import { ContactStatusService } from '@/contactInteraction/services/contactStatus.service'
import { ContactsService } from '@/contacts/services/contacts.service'
import {
  memoRow,
  type SeedContext,
} from '@/constituentFeedback/services/feedbackSeed.service'
import { SEED_MEMOS } from '@/constituentFeedback/services/feedbackSeedMemos'
import { FeedbackSynthesisService } from '@/constituentFeedback/services/feedbackSynthesis.service'
import { OutreachTextIngestService } from '@/outreach/services/outreachTextIngest.service'
import { SamplePeopleDTO } from '@/peopleDb/schemas/people.schema'
import { VoterQueryService } from '@/peopleDb/services/voterQuery.service'
import { PhoneBankingCallService } from '@/phoneBanking/services/phoneBankingCall.service'
import {
  CENSUS_COMPOSITION_SOURCE,
  type CensusCompositionSource,
} from '@/priorities/services/censusComposition'
import { PrioritiesService } from '@/priorities/services/priorities.service'
import { createPrismaBase, MODELS } from '@/prisma/util/prisma.util'
import {
  allocateAnswers,
  answerCodes,
  readGroups,
  type SeedGroup,
  seedValuesOf,
} from '../util/priorityAnswerAllocation.util'

const DEFAULT_PEOPLE = 250
// A turf is a walkable slice of the district, not the whole sample.
const TURF_SHARE = 0.6
const SHEET_SIZE = 50
const ACTIVITY_WINDOW_DAYS = 21

const DOOR_QUESTION =
  'What is the one thing you want fixed in the neighborhood?'
const PHONE_QUESTION = 'What should the city tackle first this year?'

const PANEL_INVITE_DAYS_AGO = 14
// Far above the 3% a cold invite assumes, so a seeded panel lands near 60
// to 100 members with the door and call joins.
const joinsPanel = (index: number) => index % 6 === 0
const JOIN_REPLIES = ['JOIN', 'Join please', 'yes join', 'JOIN!']
const PANEL_INVITE_MESSAGE = `Hi, it's your local office. I want to hear from neighbors before I make decisions. ${CIVIC_PANEL_JOIN_LINE}`

const PRIORITY = {
  title: 'Safer streets near schools',
  description:
    'Traffic calming, crosswalks and slower speeds on the routes kids walk to school.',
}
const PRIORITY_QUESTION =
  'What would make the walk to school safer on your street?'
const PRIORITY_ASK_DAYS_AGO = 5
// Doors drawn in each major tract for the priority ask, enough for the
// tract's voices once opt-outs and doors with no cell phone are left out.
const TRACT_HOUSEHOLDS = 5
const PRIORITY_REPLIES = [
  'A crosswalk at the corner by the elementary school. Cars never slow down there.',
  'Speed bumps on our block. People cut through at 40 during pickup.',
  'The sidewalk ends halfway down the street, so kids walk in the road.',
  'A crossing guard at the main intersection in the morning would help a lot.',
  'Better lighting. It is dark at 7am in winter and drivers cannot see the kids.',
  'Ticket the people who speed through the school zone. Nobody enforces it.',
  'Fix the cracked sidewalk near the bus stop, my son tripped there twice.',
  'A flashing sign for the school zone. The current one is hidden by a tree.',
  'Trim the hedges at the corner so drivers can see kids crossing.',
  'A four way stop at the intersection by the park would slow everyone down.',
  'More bike lanes so older kids can ride instead of being driven.',
  'Honestly the drop off line is the problem. Parents block the crosswalk.',
]

type Effort = SeedTestFixtureActivityResponse['efforts'][number]

// Dev-only: fills an existing org with a few weeks of outreach on every
// channel against real people from its district, so the CRM, the effort
// reports and synthesis have something to show. Reached only through the
// env-gated fixtures controller, never Test mode.
@Injectable()
export class ActivitySeedService extends createPrismaBase(MODELS.Outreach) {
  constructor(
    private readonly contacts: ContactsService,
    private readonly doorKnocks: ContactInteractionDoorKnockService,
    private readonly calls: PhoneBankingCallService,
    private readonly texts: ContactInteractionTextService,
    private readonly robocalls: ContactInteractionRobocallService,
    private readonly synthesis: FeedbackSynthesisService,
    private readonly statuses: ContactStatusService,
    private readonly textIngest: OutreachTextIngestService,
    private readonly priorities: PrioritiesService,
    private readonly voters: VoterQueryService,
    @Inject(CENSUS_COMPOSITION_SOURCE)
    private readonly census: CensusCompositionSource,
  ) {
    super()
  }

  async seed(
    organizationSlug: string,
    body: SeedTestFixtureActivityRequest,
  ): Promise<SeedTestFixtureActivityResponse> {
    const organization = await this.client.organization.findUnique({
      where: { slug: organizationSlug },
      include: { campaign: { select: { id: true } } },
    })
    if (organization === null) {
      throw new NotFoundException('Organization not found')
    }
    const isServe = organizationSlug.startsWith('eo-')
    const people = await this.samplePeople(organization, body.people)

    const context = {
      organizationSlug,
      actorUserId: organization.ownerId,
      isServe,
      campaignId: isServe ? null : (organization.campaign?.id ?? null),
    }
    const turfPeople = people.slice(0, Math.ceil(people.length * TURF_SHARE))
    const efforts = [
      await this.seedDoorKnocking(context, turfPeople),
      await this.seedPhoneBanking(context, people),
      await this.seedText(context, people),
      await this.seedRobocall(context, people),
    ]
    const priorityId = isServe
      ? await this.seedPanelAndPriority(
          organization,
          context,
          people,
          efforts,
          body,
        )
      : null

    for (const effort of efforts) {
      if (effort.memos === 0) continue
      const run = await this.synthesis.requestRun({
        organizationSlug,
        outreachId: effort.outreachId,
        requestedByUserId: organization.ownerId,
        trigger: 'completion',
      })
      effort.synthesisRunId = run.id
    }
    if (priorityId !== null) {
      // A priority with only a few answers has nothing to pool yet.
      await this.synthesis
        .requestPriorityRun({
          organizationSlug,
          priorityId,
          requestedByUserId: organization.ownerId,
        })
        .catch((error: unknown) => {
          if (!(error instanceof UnprocessableEntityException)) throw error
        })
    }

    return { organizationSlug, people: people.length, efforts }
  }

  private async samplePeople(organization: Organization, size?: number) {
    const sample = await this.contacts.sampleContacts(
      { size: size ?? DEFAULT_PEOPLE },
      organization,
    )
    return sample.filter(
      (person): person is Person & { cellPhone: string } =>
        person.cellPhone !== null,
    )
  }

  private async seedDoorKnocking(
    context: ActivityContext,
    people: Person[],
  ): Promise<Effort> {
    const filter = await this.client.voterFileFilter.create({
      data: {
        organizationSlug: context.organizationSlug,
        name: 'Seeded canvass',
      },
    })
    const turf = await this.client.doorKnockingTurf.create({
      data: {
        voterFileFilterId: filter.id,
        name: 'Seeded turf',
        color: '#2563eb',
        purpose: DoorKnockingPurpose.community_input,
        communityInputQuestion: DOOR_QUESTION,
        geoPoly: boundingPolygon(people),
      },
    })
    const outreach = await this.model.create({
      data: {
        organizationSlug: context.organizationSlug,
        campaignId: context.campaignId,
        outreachType: OutreachType.nativeDoorKnocking,
        status: OutreachStatus.in_progress,
        name: 'Neighborhood canvass',
        doorKnockingTurfId: turf.id,
      },
    })
    await this.client.doorKnockingRoute.create({
      data: {
        doorKnockingTurfId: turf.id,
        mode: DoorKnockingMode.walk,
        loop: false,
        totalSeconds: people.length * 120,
        totalMeters: people.length * 80,
        credits: 1,
      },
    })
    for (const [index, person] of people.entries()) {
      const { lat, lng } = coordinates(person)
      await this.client.doorKnockingStop.create({
        data: {
          doorKnockingTurfId: turf.id,
          seq: index + 1,
          lat,
          lng,
          displayAddress: person.address.line1 ?? 'Address on file',
          legSeconds: 120,
          legMeters: 80,
          targets: {
            create: {
              personId: person.id,
              name: fullName(person),
              addressKey: person.address.line1 ?? person.id,
            },
          },
        },
      })
    }

    let interactions = 0
    let memos = 0
    for (const [index, person] of people.entries()) {
      const outcome = knockOutcome(index)
      if (outcome === null) continue
      const answered = outcome === DoorKnockOutcome.answered
      const occurredAt = spreadAcrossWindow(index, people.length)
      const knock = await this.doorKnocks.recordIdempotent({
        organizationSlug: context.organizationSlug,
        personId: person.id,
        occurredAt,
        outcome,
        sourceId: randomUUID(),
        actorUserId: context.actorUserId,
        outreachId: outreach.id,
        ...(answered ? answersFor(context.isServe, index) : {}),
      })
      interactions += 1
      if (!answered) continue
      await this.client.constituentFeedback.create({
        data: {
          ...memoRow(memoContext(context, outreach.id), memos, DOOR_QUESTION),
          occurredAt,
          confirmedAt: occurredAt,
          personId: person.id,
          channel: ConstituentFeedbackChannel.door_knock,
          doorKnockInteractionId: knock.id,
        },
      })
      memos += 1
    }

    return effortSummary(outreach, interactions, memos)
  }

  private async seedPhoneBanking(
    context: ActivityContext,
    people: Array<Person & { cellPhone: string }>,
  ): Promise<Effort> {
    const filter = await this.client.voterFileFilter.create({
      data: {
        organizationSlug: context.organizationSlug,
        name: 'Seeded call list',
      },
    })
    const list = await this.client.phoneBankingList.create({
      data: {
        organizationSlug: context.organizationSlug,
        voterFileFilterId: filter.id,
        name: 'Seeded call list',
        script: `Hi, I'm calling for ${context.isServe ? 'your local office' : 'the campaign'}. ${PHONE_QUESTION}`,
        sheetCount: Math.ceil(people.length / SHEET_SIZE),
        purpose: PhoneBankingPurpose.community_input,
        communityInputQuestion: PHONE_QUESTION,
      },
    })
    const outreach = await this.model.create({
      data: {
        organizationSlug: context.organizationSlug,
        campaignId: context.campaignId,
        outreachType: OutreachType.nativePhoneBanking,
        status: OutreachStatus.in_progress,
        name: 'Community call night',
        phoneBankingListId: list.id,
      },
    })
    const entries: Array<{ entryId: number; person: Person }> = []
    for (const [index, person] of people.entries()) {
      const entry = await this.client.phoneBankingListEntry.create({
        data: {
          phoneBankingListId: list.id,
          seq: index,
          sheetIndex: Math.floor(index / SHEET_SIZE),
          phone: person.cellPhone,
          persons: {
            create: {
              personId: person.id,
              name: fullName(person),
              firstName: person.firstName,
            },
          },
        },
      })
      entries.push({ entryId: entry.id, person })
    }

    let interactions = 0
    let memos = 0
    for (const [index, { entryId, person }] of entries.entries()) {
      const outcome = callOutcome(index)
      // Some entries stay uncalled: logging the last one completes the list,
      // which starts its own synthesis run and would race the one below.
      if (outcome === null) continue
      const answered = outcome === PhoneBankCallOutcome.answered
      await this.calls.recordCall(
        list.id,
        context.organizationSlug,
        OrganizationRole.owner,
        {
          entryId,
          outcome,
          ...(answered
            ? { personId: person.id, ...answersFor(context.isServe, index) }
            : {}),
        },
        context.actorUserId,
      )
      interactions += 1
      if (!answered) continue
      const call =
        await this.client.contactInteractionPhoneBanking.findUniqueOrThrow({
          where: {
            phoneBankingListId_personId: {
              phoneBankingListId: list.id,
              personId: person.id,
            },
          },
          select: { id: true, occurredAt: true },
        })
      await this.client.constituentFeedback.create({
        data: {
          ...memoRow(memoContext(context, outreach.id), memos, PHONE_QUESTION),
          occurredAt: call.occurredAt,
          confirmedAt: call.occurredAt,
          personId: person.id,
          channel: ConstituentFeedbackChannel.phone_bank,
          phoneBankingInteractionId: call.id,
        },
      })
      memos += 1
    }

    return effortSummary(outreach, interactions, memos)
  }

  // Serve text replies are what Serve synthesis reads, so a Serve send gets
  // them as message rows; a Win send records only that someone replied.
  private async seedText(
    context: ActivityContext,
    people: Array<Person & { cellPhone: string }>,
  ): Promise<Effort> {
    const sentAt = subDays(new Date(), ACTIVITY_WINDOW_DAYS - 2)
    const outreach = await this.model.create({
      data: {
        organizationSlug: context.organizationSlug,
        campaignId: context.campaignId,
        outreachType: OutreachType.text,
        status: OutreachStatus.completed,
        name: 'Neighborhood check-in',
        message: `${PHONE_QUESTION} Reply STOP to opt out.`,
        date: sentAt,
        textCount: people.length,
      },
    })
    const replied = (index: number) => index % 5 === 0
    const optedOut = (index: number) => index % 25 === 1
    await this.texts.createManyIdempotent(
      people.map((person, index) => ({
        organizationSlug: context.organizationSlug,
        personId: person.id,
        occurredAt: sentAt,
        outreachId: outreach.id,
        respondedAt: replied(index) ? subMinutes(new Date(), index) : null,
        optedOutAt: optedOut(index) ? subMinutes(new Date(), index) : null,
      })),
    )

    let memos = 0
    if (context.isServe) {
      const replies = people.flatMap((person, index) =>
        replied(index) || optedOut(index)
          ? [
              {
                id: randomUUID(),
                outreachId: outreach.id,
                personId: person.id,
                personCellPhone: person.cellPhone,
                sentAt: subMinutes(new Date(), index),
                isOptOut: optedOut(index),
                sender: PollIndividualMessageSender.CONSTITUENT,
                content: optedOut(index)
                  ? 'STOP'
                  : SEED_MEMOS[index % SEED_MEMOS.length]!.transcript,
              },
            ]
          : [],
      )
      await this.client.pollIndividualMessage.createMany({ data: replies })
      memos = replies.filter((reply) => !reply.isOptOut).length
    }

    return effortSummary(outreach, people.length, memos)
  }

  private async seedRobocall(
    context: ActivityContext,
    people: Person[],
  ): Promise<Effort> {
    const dialedAt = subDays(new Date(), ACTIVITY_WINDOW_DAYS - 5)
    const answered = (index: number) => index % 3 === 0
    const voicemail = (index: number) => index % 3 === 1
    // Settled end to end, so no robocall sweep treats it as a live send.
    const outreach = await this.model.create({
      data: {
        organizationSlug: context.organizationSlug,
        campaignId: context.campaignId,
        outreachType: OutreachType.robocall,
        status: OutreachStatus.completed,
        name: 'Recorded reminder',
        date: dialedAt,
        robocall: {
          create: {
            audioKey: `seed/${randomUUID()}.mp3`,
            callbackNumber: '+13035550100',
            billableCount: people.length,
            amountInCents: 0,
            capturedAmountInCents: 0,
            dialedAt,
            dialingStartedAt: dialedAt,
            completedCallCount: people.length,
            completionPolledAt: dialedAt,
            poolFreedAt: dialedAt,
          },
        },
      },
    })
    await this.robocalls.createManyIdempotent(
      people.map((person, index) => ({
        organizationSlug: context.organizationSlug,
        personId: person.id,
        occurredAt: dialedAt,
        outreachId: outreach.id,
        answeredAt: answered(index) ? dialedAt : null,
        voicemailLeftAt: voicemail(index) ? dialedAt : null,
      })),
    )
    return effortSummary(outreach, people.length, 0)
  }

  // Serve's whole panel loop: an invite text whose JOIN
  // replies go through the real reply ingest, and a priority ask answered
  // well enough for a good read. Returns the priority to pool.
  private async seedPanelAndPriority(
    organization: Organization,
    context: ActivityContext,
    people: Array<Person & { cellPhone: string }>,
    efforts: Effort[],
    answers: Pick<SeedTestFixtureActivityRequest, 'answers' | 'split'>,
  ): Promise<string> {
    efforts.push(await this.seedPanelInvite(context, people))
    const { effort, priorityId } = await this.seedPriorityAsk(
      organization,
      context,
      people,
      answers,
    )
    efforts.push(effort)
    return priorityId
  }

  private async seedPanelInvite(
    context: ActivityContext,
    people: Array<Person & { cellPhone: string }>,
  ): Promise<Effort> {
    const sentAt = subDays(new Date(), PANEL_INVITE_DAYS_AGO)
    const [optedOut, members] = await this.optedOutAndMembers(context)
    const invitees = people.filter(
      (person) => !optedOut.has(person.id) && !members.has(person.id),
    )
    const list = await this.client.voterFileFilter.create({
      data: {
        organizationSlug: context.organizationSlug,
        name: 'Civic panel invite',
        civicPanelInvite: true,
        sampleSize: invitees.length,
        sampledAt: sentAt,
        sampleMembers: {
          create: invitees.map((person) => ({ personId: person.id })),
        },
      },
    })
    const outreach = await this.createTextSend(context, invitees, {
      name: 'Civic panel invite',
      message: PANEL_INVITE_MESSAGE,
      date: sentAt,
      asksToJoinCivicPanel: true,
      voterFileFilterId: list.id,
    })
    const joiners = invitees.filter((_, index) => joinsPanel(index))
    await this.textIngest.ingestReplies({
      outreachId: outreach.id,
      sourceLabel: 'staff_upload',
      rows: joiners.map((person, index) => ({
        phone: person.cellPhone,
        content: JOIN_REPLIES[index % JOIN_REPLIES.length]!,
        receivedAt: addMinutes(sentAt, 30 + index * 7),
      })),
    })
    return effortSummary(outreach, invitees.length, 0)
  }

  // Panel members are asked first, then residents not on it, the way the
  // priority flow sizes an ask, then residents drawn from each of the read's
  // major tracts. Each resident who answers also gets a coded answer, which
  // is what the priority's read counts; all of them answer unless `answers`
  // says how many, and then every major group gets its voices first.
  private async seedPriorityAsk(
    organization: Organization,
    context: ActivityContext,
    people: Array<Person & { cellPhone: string }>,
    options: Pick<SeedTestFixtureActivityRequest, 'answers' | 'split'>,
  ): Promise<{ effort: Effort; priorityId: string }> {
    const office = await this.client.electedOffice.findUniqueOrThrow({
      where: { organizationSlug: context.organizationSlug },
      select: { id: true },
    })
    const priority = await this.priorities.create(
      office.id,
      PRIORITY,
      PrioritySource.user_stated,
      'priorities_page',
    )
    const [optedOut, members] = await this.optedOutAndMembers(context)
    const { groups, tractOf, drawn } = await this.readGroupsAndTractDraws(
      organization,
      people,
    )
    const reachable = [...people, ...drawn].filter(
      (person) => !optedOut.has(person.id),
    )
    const recipients = [
      ...reachable.filter((person) => members.has(person.id)),
      ...reachable.filter((person) => !members.has(person.id)),
    ]
    const askedAt = subDays(new Date(), PRIORITY_ASK_DAYS_AGO)
    const outreach = await this.createTextSend(context, recipients, {
      name: 'Safer streets question',
      message: `${PRIORITY_QUESTION} Reply STOP to opt out.`,
      date: askedAt,
      priorityId: priority.id,
    })
    const answering = allocateAnswers(
      recipients.map((person) => ({
        person,
        values: seedValuesOf(person, tractOf.get(person.id) ?? null),
      })),
      groups,
      options.answers ?? recipients.length,
    )
    if (answering.length > 0) {
      await this.textIngest.ingestReplies({
        outreachId: outreach.id,
        sourceLabel: 'staff_upload',
        rows: answering.map(({ person }, index) => ({
          phone: person.cellPhone,
          content: PRIORITY_REPLIES[index % PRIORITY_REPLIES.length]!,
          receivedAt: addMinutes(askedAt, 20 + index * 11),
        })),
      })
      const codes = answerCodes(answering, options.split)
      await this.client.priorityAnswer.createMany({
        data: answering.map(({ person }, index) => ({
          organizationSlug: context.organizationSlug,
          outreachId: outreach.id,
          personId: person.id,
          source: PriorityAnswerSource.text,
          sourceId: `${outreach.id}:${person.id}`,
          code: codes[index]!,
          model: 'seed',
          codedAt: new Date(),
        })),
        skipDuplicates: true,
      })
    }
    return {
      effort: effortSummary(outreach, recipients.length, answering.length),
      priorityId: priority.id,
    }
  }

  // The read's major groups, from the same census-weighted frame the model
  // reads, and a few residents from each major tract. The census weighs a
  // tract by its adults, so one the district line cuts through can be a
  // major group while holding almost none of a voter file sample. No frame
  // (no district, or one the warehouse cannot read) draws nothing extra.
  private async readGroupsAndTractDraws(
    organization: Organization,
    people: Array<Person & { cellPhone: string }>,
  ): Promise<{
    groups: SeedGroup[]
    tractOf: Map<string, string>
    drawn: Array<Person & { cellPhone: string }>
  }> {
    const none = { groups: [], tractOf: new Map<string, string>(), drawn: [] }
    const district = await this.contacts
      .resolveEligibleDistrict(organization)
      .catch(() => null)
    if (!district) return none
    const inputs = await this.census.mrpInputs({ ...district, answers: [] })
    if (!inputs) return none
    const groups = readGroups(inputs.frame)
    const tractOf = new Map<string, string>()
    for (const group of groups) {
      if (group.dimension !== 'tract') continue
      const doors = await this.contacts.walkableAreaWithin(
        organization,
        { hasCellPhone: true },
        [],
        TRACT_HOUSEHOLDS,
        group.value,
      )
      for (const id of doors.flatMap((door) => door.personIds)) {
        tractOf.set(id, group.value)
      }
    }
    const sampled = new Set(people.map((person) => person.id))
    const missing = [...tractOf.keys()].filter((id) => !sampled.has(id))
    const drawn =
      missing.length === 0
        ? []
        : await this.voters.samplePeople(
            SamplePeopleDTO.create({
              districtId: district.districtId,
              size: missing.length,
              filters: { id: { in: missing } },
            }),
            district.dataset,
          )
    return {
      groups,
      tractOf,
      drawn: drawn.filter(
        (person): person is Person & { cellPhone: string } =>
          person.cellPhone !== null,
      ),
    }
  }

  private async optedOutAndMembers(
    context: ActivityContext,
  ): Promise<[Set<string>, Set<string>]> {
    const [optedOut, members] = await Promise.all([
      this.texts.findOptedOutPersonIds(context.organizationSlug),
      this.statuses.personIdsByFieldValue(
        context.organizationSlug,
        ContactStatusField.civic_panel,
        [CivicPanelStatus.member],
      ),
    ])
    return [new Set(optedOut), new Set(members)]
  }

  // A Serve text as delivery leaves it: in progress, with the recipient map
  // the reply ingest reads phones against. The ingest completes it.
  private async createTextSend(
    context: ActivityContext,
    recipients: Array<Person & { cellPhone: string }>,
    send: {
      name: string
      message: string
      date: Date
      asksToJoinCivicPanel?: boolean
      voterFileFilterId?: number
      priorityId?: string
    },
  ) {
    const outreach = await this.model.create({
      data: {
        ...send,
        organizationSlug: context.organizationSlug,
        campaignId: null,
        outreachType: OutreachType.text,
        status: OutreachStatus.in_progress,
        textCount: recipients.length,
      },
    })
    await this.client.outreachTextRecipient.createMany({
      data: recipients.map((person) => ({
        outreachId: outreach.id,
        organizationSlug: context.organizationSlug,
        personId: person.id,
        phone: person.cellPhone,
      })),
      skipDuplicates: true,
    })
    await this.texts.createManyIdempotent(
      recipients.map((person) => ({
        organizationSlug: context.organizationSlug,
        personId: person.id,
        occurredAt: send.date,
        outreachId: outreach.id,
      })),
    )
    return outreach
  }
}

type ActivityContext = {
  organizationSlug: string
  actorUserId: number
  isServe: boolean
  campaignId: number | null
}

const memoContext = (
  context: ActivityContext,
  outreachId: number,
): SeedContext => ({
  organizationSlug: context.organizationSlug,
  actorUserId: context.actorUserId,
  outreachId,
})

const effortSummary = (
  outreach: { id: number; outreachType: OutreachType },
  interactions: number,
  memos: number,
): Effort => ({
  outreachId: outreach.id,
  outreachType: outreach.outreachType,
  interactions,
  memos,
  synthesisRunId: null,
})

// Six in ten doors answer, the rest split between nobody home and a
// refusal, and one in ten is not reached yet so the turf reads in progress.
const knockOutcome = (index: number): DoorKnockOutcome | null => {
  const slot = index % 10
  if (slot < 6) return DoorKnockOutcome.answered
  if (slot < 8) return DoorKnockOutcome.not_home
  if (slot === 8) return DoorKnockOutcome.refused_to_engage
  return null
}

const callOutcome = (index: number): PhoneBankCallOutcome | null => {
  const slot = index % 10
  if (slot < 6) return PhoneBankCallOutcome.answered
  if (slot === 6) return PhoneBankCallOutcome.voicemail
  if (slot === 7) return PhoneBankCallOutcome.no_answer
  if (slot === 8) return PhoneBankCallOutcome.refused
  return null
}

const SUPPORT_CYCLE = [
  SupportAnswer.supporter,
  SupportAnswer.supporter,
  SupportAnswer.unsure,
  SupportAnswer.non_supporter,
]
const WILL_VOTE_CYCLE = [
  WillVoteAnswer.yes,
  WillVoteAnswer.yes,
  WillVoteAnswer.unsure,
  WillVoteAnswer.no,
]

const answersFor = (isServe: boolean, index: number) =>
  isServe
    ? {
        followUp: index % 4 === 0 ? FollowUpAnswer.yes : FollowUpAnswer.no,
        joinCivicPanel:
          index % 5 === 0 ? FollowUpAnswer.yes : FollowUpAnswer.no,
      }
    : {
        supportAnswer: SUPPORT_CYCLE[index % SUPPORT_CYCLE.length]!,
        willVote: WILL_VOTE_CYCLE[index % WILL_VOTE_CYCLE.length]!,
      }

const spreadAcrossWindow = (index: number, total: number) =>
  subMinutes(
    new Date(),
    Math.floor(((total - index) / total) * ACTIVITY_WINDOW_DAYS * 24 * 60),
  )

const fullName = (person: Person) =>
  [person.firstName, person.lastName].filter(Boolean).join(' ') || 'Resident'

const coordinates = (person: Person) => ({
  lat: Number(person.address.latitude ?? 0),
  lng: Number(person.address.longitude ?? 0),
})

const boundingPolygon = (people: Person[]): GeoJsonPolygon => {
  const points = people
    .map(coordinates)
    .filter(({ lat, lng }) => lat !== 0 && lng !== 0)
  const lats = points.map((point) => point.lat)
  const lngs = points.map((point) => point.lng)
  const [south, north] =
    lats.length > 0 ? [Math.min(...lats), Math.max(...lats)] : [0, 0]
  const [west, east] =
    lngs.length > 0 ? [Math.min(...lngs), Math.max(...lngs)] : [0, 0]
  return {
    type: 'Polygon',
    coordinates: [
      [
        [west, south],
        [east, south],
        [east, north],
        [west, north],
        [west, south],
      ],
    ],
  }
}
