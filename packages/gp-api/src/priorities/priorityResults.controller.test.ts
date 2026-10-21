import { useTestService } from '@/test-service'
import { HttpStatus } from '@nestjs/common'
import {
  beforeEach,
  describe,
  expect,
  it,
  onTestFinished,
  vi,
  type MockInstance,
} from 'vitest'
import { v7 as uuidv7 } from 'uuid'
import type {
  PriorityReadStatus,
  PriorityResults,
} from '@goodparty_org/contracts'
import {
  ContactStatusField,
  DoorKnockOutcome,
  OutreachStatus,
  OutreachType,
  PollIndividualMessageSender,
  PriorityAnswerCode,
  PriorityAnswerSource,
  PrioritySource,
  SynthesisRunStatus,
  SynthesisScope,
} from '@/generated/prisma'
import { ContactsService } from '@/contacts/services/contacts.service'
import { StatsService } from '@/peopleDb/services/stats.service'
import { FeaturesService } from '@/features/services/features.service'
import { seedTurfEffort } from '@/constituentFeedback/tests/issueCaptureFixtures'
import {
  ACS_COUNT_KEYS,
  type AcsCounts,
} from '@/peopleDb/databricks/districtCensusSql.util'
import type {
  DistrictCell,
  PersonAnswer,
} from '@/peopleDb/databricks/districtCensusSql.util'
import {
  CENSUS_COMPOSITION_SOURCE,
  type CensusCompositionSource,
  type MrpInputs,
} from './services/censusComposition'

const service = useTestService()

let eoId: string
let eoOrgSlug: string
let priorityId: string

const headers = () => ({ headers: { 'x-organization-slug': eoOrgSlug } })

const results = (id = priorityId) =>
  service.client.get<PriorityResults>(`/v1/priorities/${id}/results`, headers())

const readStatus = (id = priorityId) =>
  service.client.get<PriorityReadStatus>(
    `/v1/priorities/${id}/read-status`,
    headers(),
  )

let mrpInputs: MockInstance<CensusCompositionSource['mrpInputs']>

// A district of 800 people 35 to 44 and 200 aged 65 and over. Whoever is
// in `older` answered from the older band, everyone else from the younger.
const OLDER = new Set<string>()
const FRAME: MrpInputs['frame'] = [
  { count: 800, values: { age: '35to44' } },
  { count: 200, values: { age: '65plus' } },
]
const modelInputs = (answers: PersonAnswer[]): MrpInputs => {
  const cell = (band: string, people: PersonAnswer[]) => ({
    yes: people.reduce((sum, answer) => sum + answer.yes, 0),
    answers: people.length,
    values: { age: band },
  })
  return {
    frame: FRAME,
    answers: [
      cell(
        '35to44',
        answers.filter(({ personId }) => !OLDER.has(personId)),
      ),
      cell(
        '65plus',
        answers.filter(({ personId }) => OLDER.has(personId)),
      ),
    ].filter((c) => c.answers > 0),
    raceNameable: false,
  }
}

const code = async (
  outreachId: number,
  people: string[],
  answer: PriorityAnswerCode = PriorityAnswerCode.yes,
) =>
  service.prisma.priorityAnswer.createMany({
    data: people.map((personId) => ({
      organizationSlug: eoOrgSlug,
      outreachId,
      personId,
      source: PriorityAnswerSource.text,
      sourceId: `${outreachId}:${personId}`,
      code: answer,
      model: 'claude-test',
      codedAt: new Date(),
    })),
  })

// A send whose respondents all answered yes, the first `older` of them from
// the older band.
const createCodedSend = async (respondentCount: number, older: number) => {
  const send = await createTextSend(respondentCount, 0)
  send.respondents.slice(0, older).forEach((id) => OLDER.add(id))
  await code(send.outreach.id, send.respondents)
  return send
}

const pointsFor = (ids: string[]) =>
  ids.map((id, index) => ({
    id,
    lat: 35.59 + index * 0.0101234,
    lng: -82.55 - index * 0.0101234,
  }))

const createTextSend = async (
  respondentCount: number,
  silentCount: number,
  overrides: { priorityId?: string | null; status?: OutreachStatus } = {},
) => {
  const outreach = await service.prisma.outreach.create({
    data: {
      outreachType: OutreachType.text,
      organizationSlug: eoOrgSlug,
      campaignId: null,
      status: overrides.status ?? OutreachStatus.completed,
      name: 'Flooding: homeowners',
      priorityId:
        overrides.priorityId === undefined ? priorityId : overrides.priorityId,
    },
  })
  const respondents = Array.from({ length: respondentCount }, () => uuidv7())
  const silent = Array.from({ length: silentCount }, () => uuidv7())
  await service.prisma.contactInteractionText.createMany({
    data: [
      ...respondents.map((personId) => ({
        organizationSlug: eoOrgSlug,
        personId,
        outreachId: outreach.id,
        occurredAt: new Date(),
        respondedAt: new Date(),
      })),
      ...silent.map((personId) => ({
        organizationSlug: eoOrgSlug,
        personId,
        outreachId: outreach.id,
        occurredAt: new Date(),
      })),
    ],
  })
  await service.prisma.pollIndividualMessage.createMany({
    data: respondents.map((personId) => ({
      id: uuidv7(),
      personId,
      outreachId: outreach.id,
      electedOfficeId: eoId,
      sender: PollIndividualMessageSender.CONSTITUENT,
      sentAt: new Date(),
      content: 'Yes, the drain backs up.',
      isOptOut: false,
    })),
  })
  return { outreach, respondents }
}

beforeEach(async () => {
  OLDER.clear()
  eoId = uuidv7()
  eoOrgSlug = `eo-${eoId}`
  await service.prisma.organization.create({
    data: { slug: eoOrgSlug, ownerId: service.user.id },
  })
  await service.prisma.electedOffice.create({
    data: { id: eoId, userId: service.user.id, organizationSlug: eoOrgSlug },
  })
  priorityId = (
    await service.prisma.priority.create({
      data: {
        electedOfficeId: eoId,
        title: 'Oak Street flooding',
        description: 'Drains back up into homes.',
        source: PrioritySource.user_stated,
      },
    })
  ).id
  vi.spyOn(
    service.app.get(ContactsService),
    'pointsForPeople',
  ).mockImplementation(async (ids) => ({
    points: pointsFor(ids),
    truncated: false,
  }))
  vi.spyOn(
    service.app.get(ContactsService),
    'resolveEligibleDistrict',
  ).mockResolvedValue({ districtId: 'd-1', dataset: 'voters' })
  mrpInputs = vi
    .spyOn(
      service.app.get<CensusCompositionSource>(CENSUS_COMPOSITION_SOURCE),
      'mrpInputs',
    )
    .mockClear()
    .mockImplementation(async ({ answers }) => modelInputs(answers))
})

describe('GET /v1/priorities/:id/results', () => {
  it("pools a priority's sends into reach, respondents and their places", async () => {
    const { respondents } = await createTextSend(12, 8)
    await service.prisma.contactCurrentStatus.create({
      data: {
        organizationSlug: eoOrgSlug,
        personId: respondents[0]!,
        field: ContactStatusField.civic_panel,
        value: 'member',
      },
    })

    const res = await results()

    expect(res.status).toBe(HttpStatus.OK)
    expect(res.data.sends).toEqual([
      expect.objectContaining({ channel: 'text', reached: 20, responded: 12 }),
    ])
    expect(res.data.respondents).toEqual({
      total: 12,
      byChannel: { text: 12, phoneBanking: 0, doorKnocking: 0 },
      joinedCivicPanel: 1,
    })
    expect(res.data.points).toHaveLength(12)
    // Rounded to three places: a block, never a house.
    for (const { lat, lng } of res.data.points) {
      expect(Math.round(lat * 1000) / 1000).toBe(lat)
      expect(Math.round(lng * 1000) / 1000).toBe(lng)
    }
    // Nobody's answer is coded yet: no group has been heard.
    expect(res.data.readStatus).toEqual({
      answers: 12,
      checkOut: true,
      needed: 18,
      groupsHeard: 0,
      groupsTotal: 2,
      good: false,
      status: 'tooEarly',
      underrepresented: ['age35to44', 'age65plus'],
      unheard: ['age35to44', 'age65plus'],
    })
  })

  it('reads the status off the model of the coded answers', async () => {
    await createCodedSend(12, 4)

    const res = await results()

    expect(res.data.readStatus).toMatchObject({
      answers: 12,
      checkOut: true,
      needed: 12,
      good: false,
      status: 'gettingClose',
    })
    expect(mrpInputs).toHaveBeenCalledWith({
      districtId: 'd-1',
      dataset: 'voters',
      answers: expect.arrayContaining([expect.objectContaining({ yes: 1 })]),
    })
  })

  it("compares the read's groups in the answers with the district", async () => {
    await createCodedSend(12, 4)

    const res = await results()

    expect(res.data.groups).toEqual([
      {
        group: 'age35to44',
        districtShare: expect.closeTo(0.8),
        answerShare: expect.closeTo(8 / 12),
      },
      {
        group: 'age65plus',
        districtShare: expect.closeTo(0.2),
        answerShare: expect.closeTo(4 / 12),
      },
    ])
  })

  it('has no groups to compare when the district cannot be read, not an error', async () => {
    mrpInputs.mockResolvedValue(null)
    await createCodedSend(12, 4)

    const res = await results()

    expect(res.status).toBe(HttpStatus.OK)
    expect(res.data.groups).toEqual([])
  })

  it('does not count a reply that was only STOP as hearing from someone', async () => {
    const { outreach } = await createTextSend(3, 0)
    const optedOut = uuidv7()
    await service.prisma.contactInteractionText.create({
      data: {
        organizationSlug: eoOrgSlug,
        personId: optedOut,
        outreachId: outreach.id,
        occurredAt: new Date(),
        respondedAt: new Date(),
        optedOutAt: new Date(),
      },
    })
    await service.prisma.pollIndividualMessage.create({
      data: {
        id: uuidv7(),
        personId: optedOut,
        outreachId: outreach.id,
        electedOfficeId: eoId,
        sender: PollIndividualMessageSender.CONSTITUENT,
        sentAt: new Date(),
        content: 'STOP',
        isOptOut: true,
      },
    })

    const res = await results()

    expect(res.data.sends[0]).toMatchObject({ reached: 4, responded: 3 })
    expect(res.data.respondents.total).toBe(3)
  })

  it('counts a person who answered two texts once on that channel', async () => {
    const { respondents } = await createTextSend(3, 0)
    const second = await createTextSend(2, 0)
    await service.prisma.pollIndividualMessage.create({
      data: {
        id: uuidv7(),
        personId: respondents[0]!,
        outreachId: second.outreach.id,
        electedOfficeId: eoId,
        sender: PollIndividualMessageSender.CONSTITUENT,
        sentAt: new Date(),
        content: 'Still flooding.',
        isOptOut: false,
      },
    })

    const res = await results()

    expect(res.data.respondents.total).toBe(5)
    expect(res.data.respondents.byChannel.text).toBe(5)
  })

  describe('summarizing', () => {
    const run = (status: SynthesisRunStatus) =>
      service.prisma.feedbackSynthesisRun.create({
        data: {
          organizationSlug: eoOrgSlug,
          scope: SynthesisScope.priority,
          priorityId,
          status,
          conversations: 5,
          memos: 5,
          confirmed: 5,
          engine: 'test',
        },
      })

    it('reads as summarizing before the first run, once enough people answered', async () => {
      await createTextSend(5, 0)

      const res = await results()

      expect(res.data.themes).toEqual([])
      expect(res.data.summarizing).toBe(true)
    })

    it('is not summarizing with too few answers for themes', async () => {
      await createTextSend(4, 0)

      expect((await results()).data.summarizing).toBe(false)
    })

    it('reads as summarizing while a run is in flight', async () => {
      await createTextSend(5, 0)
      await run(SynthesisRunStatus.running)

      expect((await results()).data.summarizing).toBe(true)
    })

    it('stops summarizing once a run failed, so it never waits forever', async () => {
      await createTextSend(5, 0)
      await run(SynthesisRunStatus.failed)

      expect((await results()).data.summarizing).toBe(false)
    })

    it('stops summarizing once a run completed', async () => {
      await createTextSend(5, 0)
      await run(SynthesisRunStatus.completed)

      expect((await results()).data.summarizing).toBe(false)
    })
  })

  it("leaves out sends that are another priority's, unpaid or canceled", async () => {
    await createTextSend(3, 0, { priorityId: null })
    await createTextSend(3, 0, { status: OutreachStatus.pending_payment })
    await createTextSend(3, 0, { status: OutreachStatus.canceled })

    const res = await results()

    expect(res.data.sends).toEqual([])
    expect(res.data.respondents.total).toBe(0)
  })

  it('counts a walk by the knocks logged under it, not other knocks on the same people', async () => {
    const walk = await service.prisma.outreach.update({
      where: { id: (await seedTurfEffort(service, eoOrgSlug)).outreachId },
      data: { priorityId },
    })
    const other = await seedTurfEffort(service, eoOrgSlug)
    const [a, b, c] = [uuidv7(), uuidv7(), uuidv7()]
    const knock = (
      personId: string,
      outreachId: number | null,
      outcome: DoorKnockOutcome,
    ) => ({
      organizationSlug: eoOrgSlug,
      personId,
      occurredAt: new Date(),
      outcome,
      outreachId,
    })
    await service.prisma.contactInteractionDoorKnock.createMany({
      data: [
        knock(a, walk.id, DoorKnockOutcome.answered),
        knock(b, walk.id, DoorKnockOutcome.not_home),
        knock(b, other.outreachId, DoorKnockOutcome.answered),
        knock(c, null, DoorKnockOutcome.answered),
      ],
    })

    const res = await results()

    expect(res.data.sends).toEqual([
      expect.objectContaining({
        channel: 'doorKnocking',
        reached: 2,
        responded: 1,
      }),
    ])
    expect(res.data.respondents.byChannel.doorKnocking).toBe(1)
  })

  it("404s on a priority this office doesn't hold", async () => {
    const res = await results(uuidv7())
    expect(res.status).toBe(HttpStatus.NOT_FOUND)
  })

  it('404s with serve-citizen-panels off', async () => {
    await createTextSend(3, 0)
    const flag = vi
      .spyOn(service.app.get(FeaturesService), 'isFeatureEnabled')
      .mockResolvedValue(false)
    onTestFinished(() => flag.mockRestore())

    const res = await results()

    expect(res.status).toBe(HttpStatus.NOT_FOUND)
  })
})

describe('GET /v1/priorities/:id/read-status', () => {
  it('is too early while a major group has no answer, and names it', async () => {
    await createCodedSend(8, 0)

    const res = await readStatus()

    expect(res.status).toBe(HttpStatus.OK)
    expect(res.data).toEqual({
      answers: 8,
      checkOut: true,
      needed: 11,
      groupsHeard: 1,
      groupsTotal: 2,
      good: false,
      status: 'tooEarly',
      // Eight answers still leave the model unsure of the younger band.
      underrepresented: ['age65plus', 'age35to44'],
      // Only the older band has no answer at all.
      unheard: ['age65plus'],
    })
  })

  it('is not yet representative while a major group has fewer than three', async () => {
    await createCodedSend(10, 2)

    const res = await readStatus()

    expect(res.data).toEqual({
      answers: 10,
      checkOut: true,
      needed: 11,
      groupsHeard: 1,
      groupsTotal: 2,
      good: false,
      status: 'notYetRepresentative',
      underrepresented: ['age65plus', 'age35to44'],
      unheard: [],
    })
  })

  it('is getting close while the model is unsure of a group', async () => {
    await createCodedSend(12, 4)

    const res = await readStatus()

    expect(res.data).toMatchObject({
      needed: 12,
      good: false,
      status: 'gettingClose',
    })
    expect(res.data.underrepresented.length).toBeGreaterThan(0)
  })

  it('is a good read once every major group is heard and the model is sure', async () => {
    await createCodedSend(160, 40)

    const res = await readStatus()

    expect(res.data).toEqual({
      answers: 160,
      checkOut: true,
      needed: 160,
      groupsHeard: 2,
      groupsTotal: 2,
      good: true,
      status: 'representative',
      underrepresented: [],
      unheard: [],
    })
  })

  it("models each person's coded answers once, averaged, leaving out non-answers", async () => {
    const first = await createTextSend(3, 0)
    const [yes, mixed, none] = first.respondents
    await code(first.outreach.id, [yes!])
    await code(first.outreach.id, [mixed!], PriorityAnswerCode.mixed)
    await code(first.outreach.id, [none!], PriorityAnswerCode.not_an_answer)
    const second = await createTextSend(0, 0)
    await code(second.outreach.id, [yes!], PriorityAnswerCode.no)
    const elsewhere = await createTextSend(1, 0, { priorityId: null })
    await code(elsewhere.outreach.id, elsewhere.respondents)

    await readStatus()

    const answers = mrpInputs.mock.calls[0]?.[0].answers
    expect(answers).toHaveLength(2)
    expect(answers).toEqual(
      expect.arrayContaining([
        { personId: yes, yes: 0.5 },
        { personId: mixed, yes: 0.5 },
      ]),
    )
  })

  it('pools people across sends and channels, counting each once', async () => {
    const { respondents } = await createTextSend(6, 0)
    const second = await createTextSend(4, 0)
    await service.prisma.pollIndividualMessage.create({
      data: {
        id: uuidv7(),
        personId: respondents[0]!,
        outreachId: second.outreach.id,
        electedOfficeId: eoId,
        sender: PollIndividualMessageSender.CONSTITUENT,
        sentAt: new Date(),
        content: 'Still flooding.',
        isOptOut: false,
      },
    })

    const res = await readStatus()

    expect(res.data.answers).toBe(10)
  })

  it("leaves out another priority's answers", async () => {
    await createTextSend(9, 0, { priorityId: null })

    const res = await readStatus()

    expect(res.data).toMatchObject({ answers: 0, good: false })
  })

  it('says when a paid follow-up text goes out, until it does', async () => {
    const { outreach } = await createTextSend(3, 0)
    const followUp = await service.prisma.outreach.create({
      data: {
        organizationSlug: eoOrgSlug,
        outreachType: OutreachType.text,
        status: OutreachStatus.pending,
        priorityId,
        roundOneOutreachId: outreach.id,
        scheduledLocalDate: '2026-11-03',
        textCount: 250,
      },
    })

    expect((await readStatus()).data.followUp).toEqual({
      scheduledLocalDate: '2026-11-03',
      texts: 250,
    })

    await service.prisma.outreach.update({
      where: { id: followUp.id },
      data: { status: OutreachStatus.in_progress },
    })
    expect((await readStatus()).data.followUp).toBeUndefined()
    expect((await readStatus()).data.followUpSent).toBe(true)
  })

  it('treats a denied or failed follow-up as closed, never a third text', async () => {
    const { outreach } = await createTextSend(3, 0)
    await service.prisma.outreach.create({
      data: {
        organizationSlug: eoOrgSlug,
        outreachType: OutreachType.text,
        status: OutreachStatus.failed,
        priorityId,
        roundOneOutreachId: outreach.id,
        scheduledLocalDate: '2026-11-03',
        textCount: 250,
      },
    })

    const read = (await readStatus()).data
    expect(read.followUp).toBeUndefined()
    expect(read.followUpSent).toBe(true)
  })

  it('says no check is out until something has gone to residents', async () => {
    expect((await readStatus()).data.checkOut).toBeUndefined()

    await createTextSend(3, 0)

    expect((await readStatus()).data.checkOut).toBe(true)
  })

  it('says enough answers, not representative, when the district cannot be read', async () => {
    mrpInputs.mockResolvedValue(null)
    await createCodedSend(100, 3)

    const res = await readStatus()

    expect(res.data).toEqual({
      answers: 100,
      checkOut: true,
      needed: 100,
      groupsHeard: 0,
      groupsTotal: 0,
      good: true,
      status: 'enoughAnswers',
      underrepresented: [],
      unheard: [],
    })
  })

  it('sizes for the smallest major group when the district is unknown', async () => {
    mrpInputs.mockResolvedValue(null)
    await createTextSend(12, 0)

    const res = await readStatus()

    expect(res.data).toEqual({
      answers: 12,
      checkOut: true,
      needed: 100,
      groupsHeard: 0,
      groupsTotal: 0,
      good: false,
      status: 'tooEarly',
      underrepresented: [],
      unheard: [],
    })
  })

  it('models a priority once per coded answers, and again after a new one', async () => {
    const { outreach } = await createCodedSend(12, 4)

    await readStatus()
    await readStatus()
    expect(mrpInputs).toHaveBeenCalledTimes(1)

    await code(outreach.id, [uuidv7()])
    await readStatus()

    expect(mrpInputs).toHaveBeenCalledTimes(2)
  })

  it('does not keep a read that failed', async () => {
    mrpInputs.mockResolvedValueOnce(null)
    await createCodedSend(12, 4)

    expect((await readStatus()).data.status).toBe('tooEarly')
    expect((await readStatus()).data.status).toBe('gettingClose')
    expect(mrpInputs).toHaveBeenCalledTimes(2)
  })

  it("404s on a priority this office doesn't hold", async () => {
    const res = await readStatus(uuidv7())
    expect(res.status).toBe(HttpStatus.NOT_FOUND)
  })

  it('404s with serve-citizen-panels off', async () => {
    const flag = vi
      .spyOn(service.app.get(FeaturesService), 'isFeatureEnabled')
      .mockResolvedValue(false)
    onTestFinished(() => flag.mockRestore())

    const res = await readStatus()

    expect(res.status).toBe(HttpStatus.NOT_FOUND)
  })
})

describe('GET /v1/priorities/:id/read-status against census sex by age', () => {
  const zero = Object.fromEntries(
    ACS_COUNT_KEYS.map((key) => [key, 0]),
  ) as AcsCounts
  // The census says 60% of adults are 35 to 44 and 40% are 65 and over.
  const CENSUS: AcsCounts = {
    ...zero,
    populationMale35To44: 300,
    populationFemale35To44: 300,
    populationMale65Plus: 200,
    populationFemale65Plus: 200,
    populationMale18Plus: 500,
    populationFemale18Plus: 500,
  }
  const voterCell = (
    ageBand: DistrictCell['ageBand'],
    count: number,
  ): DistrictCell => ({
    ageBand,
    gender: null,
    tract: null,
    race: null,
    count,
  })

  const stubWarehouse = (voterFile: DistrictCell[]) => {
    mrpInputs.mockRestore()
    const stats = service.app.get(StatsService)
    vi.spyOn(stats, 'findDistrictCells').mockResolvedValue({
      district: CENSUS,
      cells: voterFile,
      tractAdults: new Map(),
    })
    vi.spyOn(stats, 'findAnswerCells').mockImplementation(
      async (_districtId, _dataset, answers) => [
        {
          ageBand: '35to44',
          gender: null,
          tract: null,
          race: null,
          yes: answers.length,
          count: answers.length,
        },
      ],
    )
  }

  it('names a group the census holds as major though the voter file is thin on it', async () => {
    // 2% of the voter file is 65 and over: under the 3% rule on its own.
    stubWarehouse([voterCell('35to44', 980), voterCell('65plus', 20)])
    await createCodedSend(8, 0)

    const res = await readStatus()

    expect(res.data).toMatchObject({
      groupsTotal: 2,
      groupsHeard: 1,
      good: false,
      status: 'tooEarly',
    })
    expect(res.data.underrepresented).toContain('age65plus')
  })
})

describe('POST /v1/voters/voter-file/filter kept to the parts not reached yet', () => {
  const REACHED = '37021000100'
  const UNREACHED = '37021000200'
  const TRACT_FRAME: MrpInputs['frame'] = [
    { count: 500, values: { tract: REACHED } },
    { count: 500, values: { tract: UNREACHED } },
  ]
  const reachedCell = (input: {
    answers: PersonAnswer[]
  }): MrpInputs['answers'][number] => ({
    yes: input.answers.reduce((sum, answer) => sum + answer.yes, 0),
    answers: input.answers.length,
    values: { tract: REACHED },
  })
  const inside = [uuidv7(), uuidv7()]

  const createFilter = (body: Record<string, unknown>) =>
    service.client.post('/v1/voters/voter-file/filter', body, headers())

  let gridCells: MockInstance<StatsService['findTractGridCells']>
  let geoMembers: MockInstance<ContactsService['resolveGeoMemberIds']>

  beforeEach(() => {
    // The model reads the district's two tracts: REACHED has voices,
    // UNREACHED has none.
    mrpInputs.mockImplementation(async ({ answers }) => ({
      frame: TRACT_FRAME,
      answers: answers.length === 0 ? [] : [reachedCell({ answers })],
      raceNameable: false,
    }))
    gridCells = vi
      .spyOn(service.app.get(StatsService), 'findTractGridCells')
      .mockResolvedValue([
        { row: 8900, col: -20640 },
        { row: 8900, col: -20639 },
      ])
    geoMembers = vi
      .spyOn(service.app.get(ContactsService), 'resolveGeoMemberIds')
      .mockResolvedValue(inside)
  })

  it('saves the area as the list boundary, with its people frozen', async () => {
    await createCodedSend(160, 0)

    const res = await createFilter({
      name: 'Parts we have not heard from',
      unreachedAreaOfPriorityId: priorityId,
    })

    expect(res.status).toBe(HttpStatus.CREATED)
    expect(gridCells).toHaveBeenCalledWith('d-1', 'voters', [UNREACHED], 0.004)
    const row = await service.prisma.voterFileFilter.findUniqueOrThrow({
      where: { id: res.data.id },
    })
    expect(row.geoPoly).toMatchObject({ type: 'Polygon' })
    expect(row.geoPolyLabels).toEqual([
      { name: 'Not reached yet', color: '#d97706' },
    ])
    expect(geoMembers.mock.calls[0]?.[1]).toEqual(row.geoPoly)
    const members = await service.prisma.voterFileFilterGeoMember.findMany({
      where: { voterFileFilterId: res.data.id },
      select: { personId: true },
    })
    expect(members.map((m) => m.personId).sort()).toEqual([...inside].sort())
  })

  it('draws a sample only from the people inside the area', async () => {
    await createCodedSend(160, 0)
    const draw = vi
      .spyOn(service.app.get(ContactsService), 'drawListSample')
      .mockResolvedValue([inside[0]!])

    const res = await createFilter({
      name: 'A sample where we have not heard',
      unreachedAreaOfPriorityId: priorityId,
      sample: { size: 1 },
    })

    expect(res.status).toBe(HttpStatus.CREATED)
    expect(draw.mock.calls[0]?.[2]).toMatchObject({
      size: 1,
      withinPersonIds: inside,
    })
  })

  it('refuses when every part of the district has answered', async () => {
    mrpInputs.mockImplementation(async ({ answers }) => ({
      frame: [{ count: 500, values: { tract: REACHED } }],
      answers: [reachedCell({ answers })],
      raceNameable: false,
    }))
    await createCodedSend(160, 0)

    const res = await createFilter({
      name: 'Nowhere left',
      unreachedAreaOfPriorityId: priorityId,
    })

    expect(res.status).toBe(HttpStatus.BAD_REQUEST)
  })

  it("404s on another office's priority", async () => {
    const res = await createFilter({
      name: 'Not ours',
      unreachedAreaOfPriorityId: 'not-a-priority',
    })
    expect(res.status).toBe(HttpStatus.NOT_FOUND)
  })
})
