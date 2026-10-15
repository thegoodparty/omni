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
  PrioritySource,
} from '@/generated/prisma'
import { ContactsService } from '@/contacts/services/contacts.service'
import { FeaturesService } from '@/features/services/features.service'
import { seedTurfEffort } from '@/constituentFeedback/tests/issueCaptureFixtures'
import {
  ACS_COUNT_KEYS,
  type AcsCounts,
} from '@/peopleDb/databricks/districtCensusSql.util'
import {
  CENSUS_COMPOSITION_SOURCE,
  type CensusCompositionSource,
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

const blockGroup = Object.fromEntries(
  ACS_COUNT_KEYS.map((key) => [key, 100]),
) as AcsCounts

let compose: MockInstance<CensusCompositionSource['compose']>
let population: MockInstance<CensusCompositionSource['population']>

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
  compose = vi
    .spyOn(
      service.app.get<CensusCompositionSource>(CENSUS_COMPOSITION_SOURCE),
      'compose',
    )
    .mockImplementation(async ({ personIds }) => ({
      available: true,
      district: blockGroup,
      respondentBlockGroups: personIds.map(() => blockGroup),
    }))
  // A district of 10 needs 9 answers for a good read.
  population = vi
    .spyOn(
      service.app.get<CensusCompositionSource>(CENSUS_COMPOSITION_SOURCE),
      'population',
    )
    .mockResolvedValue(10)
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
    expect(compose.mock.calls[0]?.[0]).toEqual({
      districtId: 'd-1',
      dataset: 'voters',
      personIds: expect.arrayContaining(respondents),
    })
    expect(res.data.representation?.respondentCount).toBe(12)
    expect(res.data.representation?.groups.length).toBeGreaterThan(0)
    expect(res.data.readStatus).toEqual({ answers: 12, needed: 9, good: true })
  })

  it('shows unavailable census as a comparison with no rows, not an error', async () => {
    compose.mockResolvedValue({ available: false })
    await createTextSend(12, 0)

    const res = await results()

    expect(res.status).toBe(HttpStatus.OK)
    expect(res.data.representation).toEqual({
      respondentCount: 12,
      groups: [],
    })
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

  it('withholds the comparison below the minimum number of respondents', async () => {
    await createTextSend(4, 2)

    const res = await results()

    expect(res.data.respondents.total).toBe(4)
    expect(res.data.representation).toBeNull()
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
  it('is not a good read below the answers the district needs', async () => {
    await createTextSend(8, 4)

    const res = await readStatus()

    expect(res.status).toBe(HttpStatus.OK)
    expect(res.data).toEqual({ answers: 8, needed: 9, good: false })
    expect(population).toHaveBeenCalledWith({
      districtId: 'd-1',
      dataset: 'voters',
    })
  })

  it('is a good read at exactly the answers needed', async () => {
    await createTextSend(9, 0)

    const res = await readStatus()

    expect(res.data).toEqual({ answers: 9, needed: 9, good: true })
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

    expect(res.data).toEqual({ answers: 10, needed: 9, good: true })
  })

  it("leaves out another priority's answers", async () => {
    await createTextSend(9, 0, { priorityId: null })

    const res = await readStatus()

    expect(res.data).toEqual({ answers: 0, needed: 9, good: false })
  })

  it('uses the uncorrected figure when the population is unknown', async () => {
    population.mockResolvedValue(null)
    await createTextSend(12, 0)

    const res = await readStatus()

    expect(res.data).toEqual({ answers: 12, needed: 96, good: false })
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
