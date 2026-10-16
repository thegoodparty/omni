import { randomUUID } from 'node:crypto'
import { Injectable, NotFoundException } from '@nestjs/common'
import { subDays, subMinutes } from 'date-fns'
import type {
  GeoJsonPolygon,
  Person,
  SeedTestFixtureActivityRequest,
  SeedTestFixtureActivityResponse,
} from '@goodparty_org/contracts'
import {
  ConstituentFeedbackChannel,
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
  SupportAnswer,
  WillVoteAnswer,
  type Organization,
} from '@/generated/prisma'
import { ContactInteractionDoorKnockService } from '@/contactInteraction/services/contactInteractionDoorKnock.service'
import { ContactInteractionRobocallService } from '@/contactInteraction/services/contactInteractionRobocall.service'
import { ContactInteractionTextService } from '@/contactInteraction/services/contactInteractionText.service'
import { ContactsService } from '@/contacts/services/contacts.service'
import {
  memoRow,
  type SeedContext,
} from '@/constituentFeedback/services/feedbackSeed.service'
import { SEED_MEMOS } from '@/constituentFeedback/services/feedbackSeedMemos'
import { FeedbackSynthesisService } from '@/constituentFeedback/services/feedbackSynthesis.service'
import { PhoneBankingCallService } from '@/phoneBanking/services/phoneBankingCall.service'
import { createPrismaBase, MODELS } from '@/prisma/util/prisma.util'

const DEFAULT_PEOPLE = 250
// A turf is a walkable slice of the district, not the whole sample.
const TURF_SHARE = 0.6
const SHEET_SIZE = 50
const ACTIVITY_WINDOW_DAYS = 21

const DOOR_QUESTION =
  'What is the one thing you want fixed in the neighborhood?'
const PHONE_QUESTION = 'What should the city tackle first this year?'

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
