import { HttpStatus } from '@nestjs/common'
import { addDays, format, isWeekend } from 'date-fns'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ContactInteractionTextService } from '@/contactInteraction/services/contactInteractionText.service'
import { ContactsService } from '@/contacts/services/contacts.service'
import { FeaturesService } from '@/features/services/features.service'
import { LlmService } from '@/llm/services/llm.service'
import { OrganizationsService } from '@/organizations/services/organizations.service'
import { useTestService } from '@/test-service'
import { OutreachServeComposeContextService } from './services/outreachServeComposeContext.service'

// Driven over HTTP so the @UseElectedOffice() guard, the Zod body and
// response parsing, and the flag gate run for real. Only the vendors are
// stubbed: the LLM, people-api (through ContactsService) and the feature flag.
const service = useTestService()

let orgSlug: string
const isFeatureEnabled = vi.fn()
const jsonCompletion = vi.fn()
const getDistrictStats = vi.fn()
const sampleContacts = vi.fn()
const findContactsForFilter = vi.fn()
const findOptedOutPersonIds = vi.fn()

const stub = <T>(token: new (...args: never[]) => T): T =>
  service.app.get(token)

const validDate = (): string => {
  let date = addDays(new Date(), 14)
  while (isWeekend(date)) date = addDays(date, 1)
  return format(date, 'yyyy-MM-dd')
}

const people = (count: number) =>
  Array.from({ length: count }, (_, index) => ({
    id: `person-${index}`,
    cellPhone: `512555${String(index).padStart(4, '0')}`,
  }))

const headers = () => ({ headers: { 'x-organization-slug': orgSlug } })
const postDraft = (body: object) =>
  service.client.post('/v1/outreach/serve/poll/draft', body, headers())
const postCreate = (body: object) =>
  service.client.post('/v1/outreach/serve/poll', body, headers())

const createBody = (overrides: Record<string, unknown> = {}) => ({
  topic: 'housing',
  tone: 'Warm',
  question: 'What would make housing easier for your family?',
  audience: { kind: 'sample', size: 500 },
  scheduledLocalDate: validDate(),
  biasOverridden: false,
  ...overrides,
})

beforeEach(async () => {
  orgSlug = `eo-${Date.now()}-${Math.random().toString(36).slice(2)}`
  await service.prisma.organization.create({
    data: { slug: orgSlug, ownerId: service.user.id },
  })
  await service.prisma.electedOffice.create({
    data: { userId: service.user.id, organizationSlug: orgSlug },
  })

  isFeatureEnabled.mockReset().mockResolvedValue(true)
  jsonCompletion
    .mockReset()
    .mockResolvedValue({ object: { question: 'What matters most to you?' } })
  getDistrictStats
    .mockReset()
    .mockResolvedValue({ totalConstituentsWithCellPhone: 300 })
  sampleContacts.mockReset().mockImplementation(({ size }) => people(size))
  findContactsForFilter.mockReset().mockResolvedValue({
    people: people(120),
    pagination: { totalResults: 120 },
  })
  findOptedOutPersonIds.mockReset().mockResolvedValue([])

  vi.spyOn(stub(FeaturesService), 'isFeatureEnabled').mockImplementation(
    isFeatureEnabled,
  )
  vi.spyOn(stub(LlmService), 'jsonCompletion').mockImplementation(
    jsonCompletion,
  )
  vi.spyOn(stub(ContactsService), 'getDistrictStats').mockImplementation(
    getDistrictStats,
  )
  vi.spyOn(stub(ContactsService), 'sampleContacts').mockImplementation(
    sampleContacts,
  )
  vi.spyOn(stub(ContactsService), 'findContactsForFilter').mockImplementation(
    findContactsForFilter,
  )
  vi.spyOn(stub(ContactsService), 'resolvePeopleDataset').mockResolvedValue(
    'constituents' as Awaited<
      ReturnType<ContactsService['resolvePeopleDataset']>
    >,
  )
  vi.spyOn(
    stub(ContactInteractionTextService),
    'findOptedOutPersonIds',
  ).mockImplementation(findOptedOutPersonIds)
  vi.spyOn(
    stub(OrganizationsService),
    'resolvePositionNameByOrganizationSlug',
  ).mockResolvedValue('City Council Member')
  vi.spyOn(
    stub(OutreachServeComposeContextService),
    'buildProfileContext',
  ).mockResolvedValue([])
})

describe('POST /v1/outreach/serve/poll/draft', () => {
  it('sends the topic and tone to the model and returns the parsed question', async () => {
    const res = await postDraft({ topic: 'housing', tone: 'Warm' })

    expect(res.status).toBe(HttpStatus.CREATED)
    expect(res.data).toEqual({ question: 'What matters most to you?' })
    const user = jsonCompletion.mock.calls[0]?.[0].messages[1].content
    expect(user).toContain('Topic: Housing.')
    expect(user).toContain('Tone: Warm:')
    expect(user).toContain('Write the question.')
  })

  it('improves the current draft when one is passed', async () => {
    jsonCompletion.mockResolvedValue({
      object: { question: 'How could the city make housing easier to find?' },
    })
    const res = await postDraft({
      topic: 'housing',
      tone: 'Neutral',
      currentDraft: 'Do you agree that housing costs too much?',
    })

    expect(res.data).toEqual({
      question: 'How could the city make housing easier to find?',
    })
    const user = jsonCompletion.mock.calls[0]?.[0].messages[1].content
    expect(user).toContain('Do you agree that housing costs too much?')
    expect(user).toContain('Improve the draft.')
  })

  it('refuses to invent a question for a custom topic', async () => {
    const res = await postDraft({ topic: 'custom', tone: 'Neutral' })

    expect(res.status).toBe(HttpStatus.BAD_REQUEST)
    expect(jsonCompletion).not.toHaveBeenCalled()
  })

  it('returns 502 when the model fails', async () => {
    jsonCompletion.mockRejectedValue(new Error('upstream'))
    const res = await postDraft({ topic: 'housing', tone: 'Warm' })

    expect(res.status).toBe(HttpStatus.BAD_GATEWAY)
  })

  it('returns 404 with the flag off', async () => {
    isFeatureEnabled.mockResolvedValue(false)
    const res = await postDraft({ topic: 'housing', tone: 'Warm' })

    expect(res.status).toBe(HttpStatus.NOT_FOUND)
    expect(jsonCompletion).not.toHaveBeenCalled()
  })

  it('returns 404 from the elected-office guard for an org the user does not hold', async () => {
    const res = await service.client.post(
      '/v1/outreach/serve/poll/draft',
      { topic: 'housing', tone: 'Warm' },
      { headers: { 'x-organization-slug': 'no-such-org' } },
    )

    expect(res.status).toBe(HttpStatus.NOT_FOUND)
    expect(jsonCompletion).not.toHaveBeenCalled()
  })
})

describe('POST /v1/outreach/serve/poll', () => {
  it('clamps a sample to the eligible count and prices that count', async () => {
    const res = await postCreate(createBody())

    expect(res.status).toBe(HttpStatus.CREATED)
    expect(res.data).toEqual({
      outreachId: expect.any(Number),
      recipientCount: 300,
      amountCents: 1050,
    })
    expect(sampleContacts).toHaveBeenCalledWith(
      { size: 300, excludeIds: [] },
      expect.objectContaining({ slug: orgSlug }),
    )

    const row = await service.prisma.outreach.findUniqueOrThrow({
      where: { id: res.data.outreachId },
      include: { pollDetails: true },
    })
    expect(row).toMatchObject({
      outreachType: 'poll',
      status: 'pending_payment',
      campaignId: null,
      organizationSlug: orgSlug,
      textCount: 300,
      voterFileFilterId: null,
    })
    expect(row.message).toBe(
      'Hi {{first_name}}, this is Johnny Goodparty, City Council Member. ' +
        'What would make housing easier for your family? ' +
        'Reply STOP to opt out.',
    )
    expect(row.pollDetails).toMatchObject({
      topic: 'housing',
      tone: 'Warm',
      audienceKind: 'sample',
      biasOverridden: false,
    })
  })

  it('draws the sample without opted-out people', async () => {
    findOptedOutPersonIds.mockResolvedValue(['person-1', 'person-2'])
    await postCreate(createBody())

    expect(sampleContacts).toHaveBeenCalledWith(
      { size: 300, excludeIds: ['person-1', 'person-2'] },
      expect.anything(),
    )
  })

  it('stores the saved list and list audience kind', async () => {
    const filter = await service.prisma.voterFileFilter.create({
      data: { name: 'Neighbors', organizationSlug: orgSlug },
    })
    const res = await postCreate(
      createBody({
        audience: { kind: 'list', voterFileFilterId: filter.id },
        biasOverridden: true,
      }),
    )

    expect(res.status).toBe(HttpStatus.CREATED)
    expect(res.data.recipientCount).toBe(120)
    const row = await service.prisma.outreach.findUniqueOrThrow({
      where: { id: res.data.outreachId },
      include: { pollDetails: true },
    })
    expect(row.voterFileFilterId).toBe(filter.id)
    expect(row.pollDetails).toMatchObject({
      audienceKind: 'list',
      biasOverridden: true,
    })
  })

  it('refuses a list that belongs to another organization', async () => {
    const otherSlug = `${orgSlug}-other`
    await service.prisma.organization.create({
      data: { slug: otherSlug, ownerId: service.user.id },
    })
    const filter = await service.prisma.voterFileFilter.create({
      data: { name: 'Theirs', organizationSlug: otherSlug },
    })
    const res = await postCreate(
      createBody({ audience: { kind: 'list', voterFileFilterId: filter.id } }),
    )

    expect(res.status).toBe(HttpStatus.BAD_REQUEST)
  })

  it('returns 400 and writes nothing under 25 eligible recipients', async () => {
    getDistrictStats.mockResolvedValue({ totalConstituentsWithCellPhone: 24 })
    const res = await postCreate(createBody())

    expect(res.status).toBe(HttpStatus.BAD_REQUEST)
    expect(
      await service.prisma.outreach.count({
        where: { organizationSlug: orgSlug },
      }),
    ).toBe(0)
  })

  it('returns 400 when the composed text is over the cap', async () => {
    await service.prisma.user.update({
      where: { id: service.user.id },
      data: { firstName: 'A'.repeat(1900), lastName: 'B'.repeat(100) },
    })
    const res = await postCreate(createBody({ question: 'Q'.repeat(480) }))

    expect(res.status).toBe(HttpStatus.BAD_REQUEST)
  })

  it('returns 400 for a send date outside the allowed window', async () => {
    const res = await postCreate(
      createBody({ scheduledLocalDate: format(new Date(), 'yyyy-MM-dd') }),
    )

    expect(res.status).toBe(HttpStatus.BAD_REQUEST)
  })

  it('returns 404 with the flag off and writes nothing', async () => {
    isFeatureEnabled.mockResolvedValue(false)
    const res = await postCreate(createBody())

    expect(res.status).toBe(HttpStatus.NOT_FOUND)
    expect(
      await service.prisma.outreach.count({
        where: { organizationSlug: orgSlug },
      }),
    ).toBe(0)
  })
})
