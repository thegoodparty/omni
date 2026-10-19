import { randomUUID } from 'node:crypto'
import { HttpStatus } from '@nestjs/common'
import { addBusinessDays, format } from 'date-fns'
import { beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest'
import { FeaturesService } from '@/features/services/features.service'
import {
  OutreachStatus,
  OutreachType,
  PriorityAnswerCode,
  PriorityAnswerSource,
  PrioritySource,
} from '@/generated/prisma'
import { OutreachServeSmsPurchaseHandlerService } from '@/outreach/services/outreachServeSmsPurchase.service'
import {
  ACS_COUNT_KEYS,
  type AcsCountKey,
  type AcsCounts,
  type RespondentCell,
} from '@/peopleDb/databricks/districtCensusSql.util'
import type { PersonOutput } from '@/contacts/schemas/person.schema'
import { StatsService } from '@/peopleDb/services/stats.service'
import { VoterQueryService } from '@/peopleDb/services/voterQuery.service'
import { QueueProducerService } from '@/queue/producer/queueProducer.service'
import { QueueType } from '@/queue/queue.types'
import { useTestService } from '@/test-service'
import { PriorityRoundTwoDrawService } from './services/priorityRoundTwoDraw.service'

const service = useTestService()

const TRACT_A = '53017950100'
const TRACT_B = '53017950200'

const acs = (overrides: Partial<Record<AcsCountKey, number>>): AcsCounts =>
  Object.fromEntries(
    ACS_COUNT_KEYS.map((key) => [key, overrides[key] ?? 0]),
  ) as AcsCounts

// 1,000 adults, 20% of them 65 and over, in tracts of 60% and 40%.
const DISTRICT_ACS = acs({
  totalPopulation: 1_250,
  populationUnder18: 250,
  population65Plus: 200,
})
const TRACT_ADULTS = new Map([
  [TRACT_A, 600],
  [TRACT_B, 400],
])

type FilterArg = {
  filters?: {
    filterOperators?: { id?: { operator: string; values: string[] } }
  }
}

const notInIds = (dto: FilterArg) =>
  dto.filters?.filterOperators?.id?.operator === 'notIn'
    ? dto.filters.filterOperators.id.values
    : []

const POOL = 500

const page = (totalResults: number) => ({
  people: [],
  pagination: {
    totalResults,
    currentPage: 1,
    pageSize: 1,
    totalPages: 1,
    hasNextPage: false,
    hasPreviousPage: false,
  },
})

describe('a priority round 2 text', () => {
  let slug: string
  let priorityId: string
  let poolId: number
  let roundOneId: number
  let reached: string[]
  // Who each answerer is, as the warehouse would place them.
  let profiles: Map<string, Partial<RespondentCell>>

  const headers = () => ({ headers: { 'x-organization-slug': slug } })

  const sendDate = format(addBusinessDays(new Date(), 6), 'yyyy-MM-dd')

  const create = (body: Record<string, unknown> = {}) =>
    service.client.post(
      '/v1/outreach/serve/sms',
      {
        name: 'Maple flooding, round 2',
        message:
          'this is Bryan, your City Council Member. Is it the drains?\n\nReply STOP to opt out.',
        imageUrl: 'https://assets.test/header.png',
        scheduledLocalDate: sendDate,
        voterFileFilterId: poolId,
        priorityId,
        roundTwoSize: 300,
        ...body,
      },
      { ...headers(), validateStatus: () => true },
    )

  const pay = (outreachId: number) =>
    service.app
      .get(OutreachServeSmsPurchaseHandlerService)
      .executePostPurchase('cs_test_round_two', {
        outreachId: String(outreachId),
        organizationSlug: slug,
      })

  const draw = (outreachId: number) =>
    service.client.post(
      `/v1/priorities/round-two/${outreachId}/draw`,
      {},
      { ...headers(), validateStatus: () => true },
    )

  const answer = async (
    code: PriorityAnswerCode,
    profile: Partial<RespondentCell>,
  ) => {
    const personId = randomUUID()
    profiles.set(personId, profile)
    await service.prisma.priorityAnswer.create({
      data: {
        organizationSlug: slug,
        outreachId: roundOneId,
        personId,
        source: PriorityAnswerSource.text,
        sourceId: `${roundOneId}:${personId}`,
        code,
        model: 'test',
        codedAt: new Date(),
      },
    })
  }

  let sendMessage: MockInstance<QueueProducerService['sendMessage']>
  let samplePeople: MockInstance<VoterQueryService['samplePeople']>
  let weightingInputs: MockInstance<StatsService['findWeightingInputs']>

  beforeEach(async () => {
    slug = `eo-round-two-${randomUUID()}`
    profiles = new Map()
    await service.prisma.organization.create({
      data: {
        slug,
        ownerId: service.user.id,
        overrideDistrictId: randomUUID(),
      },
    })
    const office = await service.prisma.electedOffice.create({
      data: { userId: service.user.id, organizationSlug: slug },
    })
    priorityId = (
      await service.prisma.priority.create({
        data: {
          electedOfficeId: office.id,
          title: 'Fix the flooding on Maple',
          description: 'The drains back up every storm.',
          source: PrioritySource.user_stated,
        },
      })
    ).id
    poolId = (
      await service.prisma.voterFileFilter.create({
        data: { organizationSlug: slug, name: 'Everyone with a cell' },
      })
    ).id
    // Round 1: a text that went out to three people.
    roundOneId = (
      await service.prisma.outreach.create({
        data: {
          organizationSlug: slug,
          outreachType: OutreachType.text,
          status: OutreachStatus.completed,
          priorityId,
        },
      })
    ).id
    reached = [randomUUID(), randomUUID(), randomUUID()]
    await service.prisma.outreachTextRecipient.createMany({
      data: reached.map((personId, n) => ({
        outreachId: roundOneId,
        organizationSlug: slug,
        personId,
        phone: `+1307555010${n}`,
      })),
    })

    vi.spyOn(
      service.app.get(FeaturesService),
      'isFeatureEnabled',
    ).mockResolvedValue(true)
    sendMessage = vi
      .spyOn(service.app.get(QueueProducerService), 'sendMessage')
      .mockClear()
      .mockResolvedValue(undefined)
    vi.spyOn(service.app.get(VoterQueryService), 'findPeople')
      .mockClear()
      .mockResolvedValue(page(POOL) as never)
    samplePeople = vi
      .spyOn(service.app.get(VoterQueryService), 'samplePeople')
      .mockClear()
      .mockImplementation(async (dto) =>
        Array.from(
          { length: Number(dto.size) },
          () => ({ id: randomUUID() }) as PersonOutput,
        ),
      )
    weightingInputs = vi
      .spyOn(service.app.get(StatsService), 'findWeightingInputs')
      .mockClear()
      .mockImplementation(async (_districtId, _dataset, personIds) => ({
        district: DISTRICT_ACS,
        cells: personIds.map((personId) => ({
          ageBand: '18to64' as const,
          gender: null,
          tenure: null,
          tract: TRACT_A,
          race: null,
          count: 1,
          ...profiles.get(personId),
        })),
        tractAdults: TRACT_ADULTS,
      }))
  })

  const roundTwoRow = async (outreachId: number) =>
    service.prisma.outreach.findUniqueOrThrow({
      where: { id: outreachId },
      include: {
        voterFileFilter: { include: { sampleMembers: true } },
      },
    })

  const sendsEnqueued = () =>
    sendMessage.mock.calls.filter(
      ([message]) =>
        (message as { type: QueueType }).type === QueueType.OUTREACH_TEXT_SEND,
    )

  it('is paid for at its size, held at payment, and drawn once', async () => {
    // Younger residents of one tract answered; older ones and the other
    // tract have barely been heard.
    for (let n = 0; n < 12; n++) {
      await answer(
        n % 3 === 0 ? PriorityAnswerCode.no : PriorityAnswerCode.yes,
        {},
      )
    }
    await answer(PriorityAnswerCode.mixed, { ageBand: '65plus' })
    await answer(PriorityAnswerCode.not_an_answer, { tract: TRACT_B })

    const created = await create()
    expect(created.status).toBe(HttpStatus.CREATED)
    expect(created.data.recipientCount).toBe(300)
    const { outreachId } = created.data as { outreachId: number }

    const draft = await roundTwoRow(outreachId)
    expect(draft).toMatchObject({
      textCount: 300,
      priorityId,
      status: OutreachStatus.pending_payment,
    })
    // The send holds a copy of the pool, waiting to be drawn; the pool the
    // official saved is unchanged.
    expect(draft.voterFileFilterId).not.toBe(poolId)
    expect(draft.voterFileFilter).toMatchObject({
      sampleSize: 300,
      sampledAt: null,
      name: 'Everyone with a cell, round 2',
    })
    expect(
      await service.prisma.voterFileFilter.findUniqueOrThrow({
        where: { id: poolId },
      }),
    ).toMatchObject({ sampleSize: null, sampledAt: null })

    await pay(outreachId)
    expect(await roundTwoRow(outreachId)).toMatchObject({
      status: OutreachStatus.pending,
      billableTextCount: 300,
    })
    expect(sendsEnqueued()).toHaveLength(0)
    // A redelivered webhook does not enqueue it either.
    await pay(outreachId)
    expect(sendsEnqueued()).toHaveLength(0)

    const drawn = await draw(outreachId)
    expect(drawn.status).toBe(HttpStatus.CREATED)
    expect(drawn.data).toEqual({ drawn: true, recipientCount: 300 })

    // One fit per code, then a steered draw of 85% and an unsteered 15%,
    // both leaving out who round 1 reached.
    expect(weightingInputs).toHaveBeenCalledTimes(3)
    expect(samplePeople).toHaveBeenCalledTimes(2)
    const [steered, unsteered] = samplePeople.mock.calls.map(([dto]) => dto)
    expect(steered).toMatchObject({ size: 255, weights: expect.any(Object) })
    expect(steered?.weights?.age?.['65plus']).toBeGreaterThan(
      steered?.weights?.age?.['18to64'] ?? Infinity,
    )
    expect(unsteered).toMatchObject({ size: 45 })
    expect(unsteered?.weights).toBeUndefined()
    for (const dto of [steered, unsteered]) {
      expect(notInIds(dto as FilterArg)).toEqual(
        expect.arrayContaining(reached),
      )
    }

    const frozen = await roundTwoRow(outreachId)
    expect(frozen.voterFileFilter?.sampledAt).toBeInstanceOf(Date)
    expect(frozen.voterFileFilter?.sampleMembers).toHaveLength(300)
    expect(sendsEnqueued()).toEqual([
      [
        {
          type: QueueType.OUTREACH_TEXT_SEND,
          data: { outreachId, sendSeq: 1 },
        },
        `outreachTextSend-${outreachId}`,
        {
          throwOnError: true,
          deduplicationId: `outreachTextSend-${outreachId}-1`,
        },
      ],
    ])

    // Drawn already: neither the route nor the job draws or sends again.
    expect((await draw(outreachId)).data).toEqual({
      drawn: false,
      recipientCount: 0,
    })
    await service.app
      .get(PriorityRoundTwoDrawService)
      .drawDue(addBusinessDays(new Date(), 5))
    expect(samplePeople).toHaveBeenCalledTimes(2)
    expect(sendsEnqueued()).toHaveLength(1)
  })

  it('is drawn by the job once its send date is close, unsteered when the census is unreadable', async () => {
    weightingInputs.mockRejectedValue(new Error('warehouse down'))
    const { outreachId } = (await create()).data as { outreachId: number }
    await pay(outreachId)
    const job = service.app.get(PriorityRoundTwoDrawService)

    // Today it is not due.
    await job.drawDue(new Date())
    expect(samplePeople).not.toHaveBeenCalled()

    const later = addBusinessDays(new Date(), 4)
    await job.drawDue(later)
    expect(samplePeople).toHaveBeenCalledTimes(1)
    expect(samplePeople.mock.calls[0]?.[0]).toMatchObject({ size: 300 })
    expect(samplePeople.mock.calls[0]?.[0].weights).toBeUndefined()
    expect(sendsEnqueued()).toHaveLength(1)

    await job.drawDue(later)
    expect(samplePeople).toHaveBeenCalledTimes(1)
    expect(sendsEnqueued()).toHaveLength(1)
  })

  it('goes back to undrawn when the handoff fails, and draws on the next try', async () => {
    const { outreachId } = (await create()).data as { outreachId: number }
    await pay(outreachId)
    sendMessage.mockRejectedValueOnce(new Error('sqs down'))

    expect((await draw(outreachId)).status).toBe(
      HttpStatus.INTERNAL_SERVER_ERROR,
    )
    expect((await roundTwoRow(outreachId)).voterFileFilter).toMatchObject({
      sampledAt: null,
      sampleMembers: [],
    })

    expect((await draw(outreachId)).data).toEqual({
      drawn: true,
      recipientCount: 300,
    })
  })

  it('is no bigger than the pool it draws from', async () => {
    vi.spyOn(
      service.app.get(VoterQueryService),
      'findPeople',
    ).mockResolvedValue(page(120) as never)
    const created = await create()
    expect(created.status).toBe(HttpStatus.CREATED)
    expect(created.data.recipientCount).toBe(120)
  })

  it('needs a priority, a whole list and room before its draw', async () => {
    expect((await create({ priorityId: undefined })).status).toBe(
      HttpStatus.BAD_REQUEST,
    )
    expect(
      (
        await create({
          scheduledLocalDate: format(
            addBusinessDays(new Date(), 3),
            'yyyy-MM-dd',
          ),
        })
      ).status,
    ).toBe(HttpStatus.BAD_REQUEST)
    await service.prisma.voterFileFilter.update({
      where: { id: poolId },
      data: { sampleSize: 50, sampledAt: new Date() },
    })
    expect((await create()).status).toBe(HttpStatus.BAD_REQUEST)
    expect(
      await service.prisma.outreach.count({
        where: { organizationSlug: slug, id: { not: roundOneId } },
      }),
    ).toBe(0)
  })
})
