import { randomUUID } from 'node:crypto'
import { HttpStatus } from '@nestjs/common'
import { addBusinessDays, addDays, format } from 'date-fns'
import { beforeEach, describe, expect, it, type Mock, vi } from 'vitest'
import type { Person } from '@goodparty_org/contracts'
import { ContactInteractionTextService } from '@/contactInteraction/services/contactInteractionText.service'
import { ContactsService } from '@/contacts/services/contacts.service'
import { FeaturesService } from '@/features/services/features.service'
import { OutreachStatus, PrioritySource } from '@/generated/prisma'
import { OrganizationsService } from '@/organizations/services/organizations.service'
import { PurchaseType } from '@/payments/purchase.types'
import { QueueProducerService } from '@/queue/producer/queueProducer.service'
import { SERVE_CITIZEN_PANELS_FLAG } from '@/shared/util/serveCitizenPanelsFlag.util'
import { useTestService } from '@/test-service'
import { calcTextAmountInCents } from '@/shared/util/textPricing.util'
import { StripeService } from '@/vendors/stripe/services/stripe.service'
import { OutreachServeSmsPurchaseHandlerService } from '../services/outreachServeSmsPurchase.service'

// Free sends are set by one internal service and nothing else. An official
// in serve-citizen-panels who creates an ordinary text, a priority text or a
// poll still pays at checkout, and no request field can make a send free.
const service = useTestService()

// Smuggled into every request: the pilot funding, and the id of a real
// managed wave of this very office.
let SMUGGLED: { fundedBy: string; managedPanelWaveId: string }
let inFlag: boolean

const person = (n: number): Person =>
  ({
    id: randomUUID(),
    firstName: 'Jane',
    lastName: `Resident ${n}`,
    cellPhone: `30755500${String(n).padStart(2, '0')}`,
  }) as Person

let slug: string
let filterId: number
let priorityId: string
let sendMessage: Mock<QueueProducerService['sendMessage']>
let createSession: Mock<StripeService['createCustomCheckoutSession']>

beforeEach(async () => {
  slug = `eo-paid-${Date.now()}-${Math.random().toString(36).slice(2)}`
  await service.prisma.organization.create({
    data: { slug, ownerId: service.user.id },
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
  ).id
  filterId = (
    await service.prisma.voterFileFilter.create({
      data: { organizationSlug: slug, name: 'Maple renters' },
    })
  ).id

  const enrollment = await service.prisma.managedCivicPanel.create({
    data: {
      organizationSlug: slug,
      inviteMessage: 'Join my civic panel. Reply STOP to opt out.',
      consentVersion: 'v1',
      approvedAt: new Date(),
      approvedByUserId: service.user.id,
      goalMembers: 100,
    },
  })
  const wave = await service.prisma.managedPanelWave.create({
    data: { enrollmentId: enrollment.id, wave: 1 },
  })
  SMUGGLED = { fundedBy: 'goodparty_pilot', managedPanelWaveId: wave.id }

  // Every other rollout flag is on, so each route is reachable; only
  // serve-citizen-panels varies.
  vi.spyOn(
    service.app.get(FeaturesService),
    'isFeatureEnabled',
  ).mockImplementation(({ feature }) =>
    Promise.resolve(feature !== SERVE_CITIZEN_PANELS_FLAG || inFlag),
  )
  const people = Array.from({ length: 30 }, (_, n) => person(n))
  vi.spyOn(
    service.app.get(ContactsService),
    'findContactsForFilter',
  ).mockResolvedValue({
    people,
    pagination: {
      totalResults: people.length,
      currentPage: 1,
      pageSize: 1000,
      totalPages: 1,
      hasNextPage: false,
      hasPreviousPage: false,
    },
  })
  vi.spyOn(
    service.app.get(ContactsService),
    'getDistrictStats',
  ).mockResolvedValue({ totalConstituentsWithCellPhone: 300 } as Awaited<
    ReturnType<ContactsService['getDistrictStats']>
  >)
  vi.spyOn(
    service.app.get(ContactsService),
    'sampleContacts',
  ).mockImplementation(({ size }) =>
    Promise.resolve(
      Array.from({ length: size }, (_, n) => person(n)) as Awaited<
        ReturnType<ContactsService['sampleContacts']>
      >,
    ),
  )
  vi.spyOn(
    service.app.get(ContactsService),
    'resolvePeopleDataset',
  ).mockResolvedValue({ base: 'constituents' } as Awaited<
    ReturnType<ContactsService['resolvePeopleDataset']>
  >)
  vi.spyOn(
    service.app.get(ContactInteractionTextService),
    'findOptedOutPersonIds',
  ).mockResolvedValue([])
  vi.spyOn(
    service.app.get(OrganizationsService),
    'resolvePositionNameByOrganizationSlug',
  ).mockResolvedValue('City Council Member')
  sendMessage = vi
    .fn<QueueProducerService['sendMessage']>()
    .mockResolvedValue(undefined)
  vi.spyOn(
    service.app.get(QueueProducerService),
    'sendMessage',
  ).mockImplementation(sendMessage)
  createSession = vi
    .fn<StripeService['createCustomCheckoutSession']>()
    .mockResolvedValue({
      id: 'cs_test_paid',
      clientSecret: 'secret',
      amount: 1,
    })
  vi.spyOn(
    service.app.get(StripeService),
    'createCustomCheckoutSession',
  ).mockImplementation(createSession)
})

const headers = () => ({ headers: { 'x-organization-slug': slug } })

const smsBody = (extra: Record<string, unknown> = {}) => ({
  name: 'Maple renters',
  message:
    'this is your City Council Member. Is it the drains?\n\n' +
    'Reply STOP to opt out.',
  imageUrl: 'https://assets.test/header.png',
  scheduledLocalDate: format(addBusinessDays(new Date(), 5), 'yyyy-MM-dd'),
  voterFileFilterId: filterId,
  ...SMUGGLED,
  ...extra,
})

const pollDate = (): string => {
  let date = addDays(new Date(), 14)
  while ([0, 6].includes(date.getDay())) date = addDays(date, 1)
  return format(date, 'yyyy-MM-dd')
}

const expectPaidDraft = async (outreachId: number) => {
  const row = await service.prisma.outreach.findUniqueOrThrow({
    where: { id: outreachId },
  })
  expect(row).toMatchObject({
    status: OutreachStatus.pending_payment,
    fundedBy: null,
    managedPanelWaveId: null,
  })

  const checkout = await service.client.post(
    '/v1/payments/purchase/create-checkout-session',
    {
      type: PurchaseType.SERVE_TEXT,
      metadata: { outreachId, ...SMUGGLED },
    },
    headers(),
  )
  expect(checkout.data).toMatchObject({ id: 'cs_test_paid' })
  expect(checkout.status).toBe(HttpStatus.CREATED)
  const amount = createSession.mock.calls.at(-1)?.[1].amount
  expect(amount).toBeGreaterThan(0)
  expect(amount).toBe(calcTextAmountInCents(row.textCount ?? 0))

  const free = await service.client.post(
    '/v1/payments/purchase/complete-free-purchase',
    {
      purchaseType: PurchaseType.SERVE_TEXT,
      metadata: { outreachId, organizationSlug: slug, ...SMUGGLED },
    },
    headers(),
  )
  expect(free.status).toBeGreaterThanOrEqual(HttpStatus.BAD_REQUEST)
  expect(sendMessage).not.toHaveBeenCalled()
  expect(
    await service.prisma.outreach.findUniqueOrThrow({
      where: { id: outreachId },
    }),
  ).toMatchObject({ status: OutreachStatus.pending_payment, fundedBy: null })
}

describe.each([
  { inFlag: true, who: 'in serve-citizen-panels' },
  { inFlag: false, who: 'outside serve-citizen-panels' },
])('an official $who still pays', (scenario) => {
  beforeEach(() => {
    inFlag = scenario.inFlag
  })

  it('for an ordinary Serve text, whatever the request carries', async () => {
    const res = await service.client.post(
      '/v1/outreach/serve/sms',
      smsBody(),
      headers(),
    )

    expect(res.status).toBe(HttpStatus.CREATED)
    await expectPaidDraft(res.data.outreachId)
  })

  it('for a priority text', async () => {
    const res = await service.client.post(
      '/v1/outreach/serve/sms',
      smsBody({
        priorityId,
        stepId: 'define',
        side: 'main',
        proposalKey: randomUUID(),
      }),
      headers(),
    )

    expect(res.status).toBe(HttpStatus.CREATED)
    await expectPaidDraft(res.data.outreachId)
    expect(
      await service.prisma.outreach.count({
        where: { organizationSlug: slug, fundedBy: { not: null } },
      }),
    ).toBe(0)
  })

  it('for a poll', async () => {
    const res = await service.client.post(
      '/v1/outreach/serve/poll',
      {
        topic: 'housing',
        tone: 'Warm',
        question: 'What would make housing easier for your family?',
        audience: { kind: 'sample', size: 100 },
        scheduledLocalDate: pollDate(),
        biasOverridden: false,
        ...SMUGGLED,
      },
      headers(),
    )

    expect(res.status).toBe(HttpStatus.CREATED)
    await expectPaidDraft(res.data.outreachId)
  })

  it('and paying leaves the send unfunded by the pilot', async () => {
    const res = await service.client.post(
      '/v1/outreach/serve/sms',
      smsBody(),
      headers(),
    )
    await service.app
      .get(OutreachServeSmsPurchaseHandlerService)
      .executePostPurchase('cs_test_paid', {
        outreachId: String(res.data.outreachId),
        organizationSlug: slug,
        ...SMUGGLED,
      })

    expect(
      await service.prisma.outreach.findUniqueOrThrow({
        where: { id: res.data.outreachId },
      }),
    ).toMatchObject({
      status: OutreachStatus.pending,
      stripeCheckoutSessionId: 'cs_test_paid',
      fundedBy: null,
    })
  })
})

describe('no outreach create route takes a funding field', () => {
  beforeEach(() => {
    inFlag = true
  })

  it('refuses it on the Win create, whose schema is strict', async () => {
    await service.prisma.campaign.create({
      data: {
        slug,
        organizationSlug: slug,
        userId: service.user.id,
        isPro: true,
        details: {
          electionDate: format(addDays(new Date(), 60), 'yyyy-MM-dd'),
        },
      },
    })
    const campaign = await service.prisma.campaign.findFirstOrThrow({
      where: { slug },
    })

    const res = await service.client.post(
      '/v1/outreach',
      {
        campaignId: campaign.id,
        outreachType: 'text',
        message: 'Hello',
        ...SMUGGLED,
      },
      headers(),
    )

    expect(res.status).toBe(HttpStatus.BAD_REQUEST)
    expect(
      await service.prisma.outreach.count({
        where: { campaignId: campaign.id },
      }),
    ).toBe(0)
  })

  it('never stores one from any of them', async () => {
    await service.client.post('/v1/outreach/serve/sms', smsBody(), headers())
    await service.client.post(
      '/v1/outreach/serve/poll',
      {
        topic: 'housing',
        tone: 'Warm',
        question: 'What would make housing easier for your family?',
        audience: { kind: 'sample', size: 100 },
        scheduledLocalDate: pollDate(),
        biasOverridden: false,
        ...SMUGGLED,
      },
      headers(),
    )

    expect(
      await service.prisma.outreach.count({
        where: { organizationSlug: slug },
      }),
    ).toBeGreaterThan(0)
    expect(
      await service.prisma.outreach.count({
        where: {
          OR: [
            { fundedBy: { not: null } },
            { managedPanelWaveId: { not: null } },
          ],
        },
      }),
    ).toBe(0)
  })
})
