import { randomUUID } from 'node:crypto'
import { HttpStatus } from '@nestjs/common'
import { addBusinessDays, format, parseISO, subDays, subHours } from 'date-fns'
import { parsePriorityStatus } from '@goodparty_org/contracts'
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
  OutreachServeSmsCreateService,
  roundTwoDrawCutoff,
} from '@/outreach/services/outreachServeSmsCreate.service'
import { calcTextAmountInCents } from '@/shared/util/textPricing.util'
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
import { VoterFileFilterService } from '@/voters/services/voterFileFilter.service'
import {
  PriorityRoundTwoDrawService,
  ROUND_TWO_DREW_NOBODY,
} from './services/priorityRoundTwoDraw.service'

const service = useTestService()

const TRACT_A = '53017950100'
const TRACT_B = '53017950200'

const acs = (overrides: Partial<Record<AcsCountKey, number>>): AcsCounts =>
  Object.fromEntries(
    ACS_COUNT_KEYS.map((key) => [key, overrides[key] ?? 0]),
  ) as AcsCounts

// 1,000 adults, 20% of them 65 and over, in tracts of 60% and 40%.
// Adults sit in two of the census's six age bands, 35 to 44 and 65 and
// over; the 18+ sex totals are left out, so gender sits out of these tests.
const DISTRICT_ACS = acs({
  populationMale35To44: 400,
  populationFemale35To44: 400,
  populationMale65Plus: 100,
  populationFemale65Plus: 100,
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

// Round 1 goes to ROUND_ONE of the pool; the follow-up draws from the rest.
const POOL = 1_000
const ROUND_ONE = 300

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

describe("a priority text's follow-up", () => {
  let slug: string
  let priorityId: string
  let poolId: number
  let roundOneId: number
  let reached: string[]
  // Who each answerer is, as the warehouse would place them.
  let profiles: Map<string, Partial<RespondentCell>>
  // The first send of the purchase under test, whose own enqueue is not
  // what these tests are about.
  let firstSend: number | undefined

  const headers = () => ({ headers: { 'x-organization-slug': slug } })

  // From the create's own cutoff, which is Pacific-anchored, so the test
  // does not depend on the runner's time zone or time of day.
  const sendDate = format(
    addBusinessDays(parseISO(roundTwoDrawCutoff(new Date())), 3),
    'yyyy-MM-dd',
  )

  const followUpDate = format(
    addBusinessDays(parseISO(sendDate), 10),
    'yyyy-MM-dd',
  )

  const create = (body: Record<string, unknown> = {}) =>
    service.client.post(
      '/v1/outreach/serve/sms',
      {
        name: 'Maple flooding',
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

  // One purchase: the first send and its follow-up.
  const createRounds = async (body: Record<string, unknown> = {}) => {
    const { data } = (await create(body)) as {
      data: { outreachId: number; followUp: { outreachId: number } }
    }
    firstSend = data.outreachId
    return { roundOne: data.outreachId, roundTwo: data.followUp.outreachId }
  }

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
    firstSend = undefined
    // Who the first send reaches; the warehouse is not here to count it.
    vi.spyOn(
      service.app.get(OutreachServeSmsCreateService),
      'resolveListAudienceCount',
    ).mockResolvedValue({
      recipientCount: ROUND_ONE,
      excludedOptedOutCount: 0,
      excludedDuplicatePhoneCount: 0,
    })
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
          ageBand: '35to44' as const,
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
    sendMessage.mock.calls.filter(([message]) => {
      const { type, data } = message as {
        type: QueueType
        data: { outreachId: number }
      }
      return (
        type === QueueType.OUTREACH_TEXT_SEND && data.outreachId !== firstSend
      )
    })

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
    expect(created.data).toMatchObject({
      recipientCount: ROUND_ONE,
      followUp: { recipientCount: 300, scheduledLocalDate: followUpDate },
    })
    const roundOne = created.data.outreachId as number
    firstSend = roundOne
    const outreachId = created.data.followUp.outreachId as number

    const draft = await roundTwoRow(outreachId)
    expect(draft).toMatchObject({
      textCount: 300,
      priorityId,
      roundOneOutreachId: roundOne,
      scheduledLocalDate: followUpDate,
      proposalKey: null,
      status: OutreachStatus.pending_payment,
    })
    // One checkout prices both rounds.
    expect(
      await service.app
        .get(OutreachServeSmsPurchaseHandlerService)
        .calculateAmount({
          outreachId: String(roundOne),
          organizationSlug: slug,
        }),
    ).toBe(calcTextAmountInCents(ROUND_ONE + 300))
    // The send holds a copy of the pool, waiting to be drawn; the pool the
    // official saved is unchanged.
    expect(draft.voterFileFilterId).not.toBe(poolId)
    expect(draft.voterFileFilter).toMatchObject({
      sampleSize: 300,
      sampledAt: null,
      name: 'Everyone with a cell, follow-up',
    })
    expect(
      await service.prisma.voterFileFilter.findUniqueOrThrow({
        where: { id: poolId },
      }),
    ).toMatchObject({ sampleSize: null, sampledAt: null })

    await pay(roundOne)
    expect(await roundTwoRow(outreachId)).toMatchObject({
      status: OutreachStatus.pending,
      billableTextCount: 300,
      stripeCheckoutSessionId: 'cs_test_round_two',
    })
    expect(await roundTwoRow(roundOne)).toMatchObject({
      status: OutreachStatus.pending,
      billableTextCount: ROUND_ONE,
    })
    expect(sendsEnqueued()).toHaveLength(0)
    // A redelivered webhook does not enqueue it either.
    await pay(roundOne)
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
      steered?.weights?.age?.['35to44'] ?? Infinity,
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
    const { roundOne } = await createRounds()
    await pay(roundOne)
    const job = service.app.get(PriorityRoundTwoDrawService)

    // Not while round 1's replies are still coming in.
    await job.drawDue(new Date())
    await job.drawDue(addBusinessDays(new Date(), 4))
    expect(samplePeople).not.toHaveBeenCalled()

    const later = addBusinessDays(new Date(), 14)
    await job.drawDue(later)
    expect(samplePeople).toHaveBeenCalledTimes(1)
    expect(samplePeople.mock.calls[0]?.[0]).toMatchObject({ size: 300 })
    expect(samplePeople.mock.calls[0]?.[0].weights).toBeUndefined()
    expect(sendsEnqueued()).toHaveLength(1)

    await job.drawDue(later)
    expect(samplePeople).toHaveBeenCalledTimes(1)
    expect(sendsEnqueued()).toHaveLength(1)
  })

  it('goes back to unpaid with its first half when the first send cannot be enqueued', async () => {
    const { roundOne, roundTwo } = await createRounds()
    sendMessage.mockRejectedValueOnce(new Error('sqs down'))

    await expect(pay(roundOne)).rejects.toThrow('sqs down')
    expect(await roundTwoRow(roundOne)).toMatchObject({
      status: OutreachStatus.pending_payment,
    })
    expect(await roundTwoRow(roundTwo)).toMatchObject({
      status: OutreachStatus.pending_payment,
    })

    // Stripe's redelivery claims both again.
    await pay(roundOne)
    expect(await roundTwoRow(roundTwo)).toMatchObject({
      status: OutreachStatus.pending,
    })
  })

  it('goes back to undrawn when the handoff fails, and draws on the next try', async () => {
    const { roundOne, roundTwo: outreachId } = await createRounds()
    await pay(roundOne)
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

  // A tenth of the people left stays unsold, so a draw that finds some of
  // them opted out or reached another way still fills the follow-up.
  it('is at most 90% of what the pool holds past the first send', async () => {
    vi.spyOn(
      service.app.get(VoterQueryService),
      'findPeople',
    ).mockResolvedValue(page(ROUND_ONE + 120) as never)
    const created = await create()
    expect(created.status).toBe(HttpStatus.CREATED)
    expect(created.data.followUp.recipientCount).toBe(108)
  })

  it('is left out when 90% of what is left is too few for a text', async () => {
    vi.spyOn(
      service.app.get(VoterQueryService),
      'findPeople',
    ).mockResolvedValue(page(ROUND_ONE + 27) as never)
    const created = await create()
    expect(created.status).toBe(HttpStatus.CREATED)
    expect(created.data.followUp).toBeUndefined()
  })

  describe('its undrawn list', () => {
    const listIds = async () => {
      const res = await service.client.get<{ id: number }[]>(
        '/v1/voters/voter-file/filters',
        headers(),
      )
      return res.data.map((list) => list.id)
    }

    it('stays off the lists index and cannot be edited or deleted, even by link', async () => {
      const { roundTwo } = await createRounds()
      const { voterFileFilterId } = await roundTwoRow(roundTwo)
      if (voterFileFilterId === null) throw new Error('expected a list')

      const ids = await listIds()
      expect(ids).toContain(poolId)
      expect(ids).not.toContain(voterFileFilterId)

      const edit = await service.client.put(
        `/v1/voters/voter-file/filter/${voterFileFilterId}`,
        { name: 'Mine now' },
        { ...headers(), validateStatus: () => true },
      )
      expect(edit.status).toBe(HttpStatus.CONFLICT)
      const remove = await service.client.delete(
        `/v1/voters/voter-file/filter/${voterFileFilterId}`,
        { ...headers(), validateStatus: () => true },
      )
      expect(remove.status).toBe(HttpStatus.CONFLICT)
      expect(
        await service.prisma.voterFileFilter.count({
          where: { id: voterFileFilterId },
        }),
      ).toBe(1)
    })
  })

  it('is left out when too few are left for a text of its own', async () => {
    vi.spyOn(
      service.app.get(VoterQueryService),
      'findPeople',
    ).mockResolvedValue(page(ROUND_ONE + 10) as never)
    const created = await create()
    expect(created.status).toBe(HttpStatus.CREATED)
    expect(created.data.followUp).toBeUndefined()
    expect(
      await service.prisma.outreach.count({
        where: { roundOneOutreachId: created.data.outreachId },
      }),
    ).toBe(0)
  })

  it('needs a priority', async () => {
    expect((await create({ priorityId: undefined })).status).toBe(
      HttpStatus.BAD_REQUEST,
    )
    expect(
      await service.prisma.outreach.count({
        where: { organizationSlug: slug, id: { not: roundOneId } },
      }),
    ).toBe(0)
  })

  const PROPOSAL_KEY = '9a4c2e71-3b5d-4f68-8c19-6d7e2f3a4b50'

  // The priority's define check, offered and not yet out.
  const askCheck = () =>
    service.prisma.priority.update({
      where: { id: priorityId },
      data: {
        status: {
          version: 3,
          steps: [
            {
              id: 'define',
              state: 'settled',
              summary: 'The drains are the problem.',
              check: {
                state: 'asked',
                who: 'Renters on the flood blocks',
                question: 'Is it the drains?',
                raised: 0,
                offeredAt: '2026-09-30T12:00:00Z',
              },
            },
          ],
        },
      },
    })

  const defineCheck = async () =>
    parsePriorityStatus(
      (
        await service.prisma.priority.findUniqueOrThrow({
          where: { id: priorityId },
        })
      ).status,
    ).steps.find((step) => step.id === 'define')?.check

  const linked = { proposalKey: PROPOSAL_KEY, stepId: 'define', side: 'main' }

  it('puts its check out with the first send, and the follow-up keeps it out', async () => {
    await askCheck()
    const { roundOne, roundTwo } = await createRounds(linked)
    expect(await roundTwoRow(roundOne)).toMatchObject({
      proposalKey: PROPOSAL_KEY,
    })
    await pay(roundOne)
    expect(await defineCheck()).toMatchObject({
      state: 'out',
      sentProposalKey: PROPOSAL_KEY,
    })

    await draw(roundTwo)
    expect(await defineCheck()).toMatchObject({
      state: 'out',
      sentProposalKey: PROPOSAL_KEY,
    })
  })

  it('is canceled unsent when it draws nobody', async () => {
    await askCheck()
    const { roundOne, roundTwo: outreachId } = await createRounds(linked)
    await pay(roundOne)
    samplePeople.mockResolvedValue([])

    expect((await draw(outreachId)).data).toEqual({
      drawn: false,
      recipientCount: 0,
    })
    expect(await roundTwoRow(outreachId)).toMatchObject({
      status: OutreachStatus.canceled,
      canceledBy: ROUND_TWO_DREW_NOBODY,
      voterFileFilter: { sampledAt: null, sampleMembers: [] },
    })
    expect(sendsEnqueued()).toHaveLength(0)
  })

  // The draw's commit and its enqueue are two steps; a process that dies
  // between them leaves a drawn send nobody handed off.
  it('hands off a send drawn but never enqueued, and nothing else', async () => {
    const { roundOne, roundTwo: outreachId } = await createRounds()
    await pay(roundOne)
    const { voterFileFilterId } = await roundTwoRow(outreachId)
    const drawnAt = subHours(new Date(), 2)
    await service.prisma.voterFileFilter.update({
      where: { id: voterFileFilterId ?? 0 },
      data: { createdAt: subDays(drawnAt, 3), sampledAt: drawnAt },
    })
    await service.prisma.voterFileFilterSampleMember.createMany({
      data: [randomUUID(), randomUUID()].map((personId) => ({
        voterFileFilterId: voterFileFilterId ?? 0,
        personId,
      })),
    })
    // An ordinary sampled text, waiting on its consumer: drawn when its
    // list was saved, so never mistaken for a stranded round 2.
    const sampled = await service.prisma.voterFileFilter.create({
      data: {
        organizationSlug: slug,
        sampleSize: 2,
        sampledAt: subDays(new Date(), 1),
        createdAt: subDays(new Date(), 1),
        sampleMembers: { create: [{ personId: randomUUID() }] },
      },
    })
    await service.prisma.outreach.create({
      data: {
        organizationSlug: slug,
        outreachType: OutreachType.text,
        status: OutreachStatus.pending,
        priorityId,
        voterFileFilterId: sampled.id,
      },
    })

    await service.app.get(PriorityRoundTwoDrawService).drawDue(new Date())

    expect(samplePeople).not.toHaveBeenCalled()
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
  })

  it('leaves no list behind when the create fails after copying it', async () => {
    const lists = service.app.get(VoterFileFilterService)
    const copy = lists.createUndrawnSampleOf.bind(lists)
    vi.spyOn(lists, 'createUndrawnSampleOf').mockImplementationOnce(
      async (...args) => {
        await copy(...args)
        throw new Error('insert failed')
      },
    )

    expect((await create()).status).toBe(HttpStatus.INTERNAL_SERVER_ERROR)
    expect(
      await service.prisma.voterFileFilter.count({
        where: { organizationSlug: slug, id: { not: poolId } },
      }),
    ).toBe(0)
  })
})
