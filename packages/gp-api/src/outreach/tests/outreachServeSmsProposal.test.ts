import { randomUUID } from 'node:crypto'
import { HttpStatus } from '@nestjs/common'
import { addBusinessDays, format } from 'date-fns'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { parsePriorityStatus, type Person } from '@goodparty_org/contracts'
import { ContactsService } from '@/contacts/services/contacts.service'
import { FeaturesService } from '@/features/services/features.service'
import { QueueProducerService } from '@/queue/producer/queueProducer.service'
import { useTestService } from '@/test-service'
import { OutreachStatus, PrioritySource } from '../../generated/prisma'
import { OutreachServeSmsPurchaseHandlerService } from '../services/outreachServeSmsPurchase.service'

const service = useTestService()

const PROPOSAL_KEY = '3c9a7e51-0d2b-4f6e-9a18-5b7c2d4e6f80'

const person = (n: number): Person =>
  ({
    id: randomUUID(),
    firstName: 'Jane',
    lastName: `Renter ${n}`,
    cellPhone: `30755500${String(n).padStart(2, '0')}`,
    address: { line1: `${n} Main St` },
  }) as Person

// A text from a chat card holds the card's key from its draft on, but is not
// sent until it is paid for: only then does the card read as sent and the
// priority's check go out.
describe('a Serve text carrying a proposal link', () => {
  let slug: string
  let priorityId: string
  let filterId: number

  beforeEach(async () => {
    slug = `eo-sms-${Date.now()}-${Math.random().toString(36).slice(2)}`
    await service.prisma.organization.create({
      data: { slug, ownerId: service.user.id },
    })
    const office = await service.prisma.electedOffice.create({
      data: { userId: service.user.id, organizationSlug: slug },
    })
    const priority = await service.prisma.priority.create({
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
    priorityId = priority.id
    filterId = (
      await service.prisma.voterFileFilter.create({
        data: { organizationSlug: slug, name: 'Flood block renters' },
      })
    ).id

    vi.spyOn(
      service.app.get(FeaturesService),
      'isFeatureEnabled',
    ).mockResolvedValue(true)
    vi.spyOn(
      service.app.get(ContactsService),
      'findContactsForFilter',
    ).mockResolvedValue({
      people: Array.from({ length: 30 }, (_, n) => person(n)),
      pagination: {
        totalResults: 30,
        currentPage: 1,
        pageSize: 1000,
        totalPages: 1,
        hasNextPage: false,
        hasPreviousPage: false,
      },
    })
    vi.spyOn(
      service.app.get(QueueProducerService),
      'sendMessage',
    ).mockResolvedValue(true)
  })

  const headers = () => ({ headers: { 'x-organization-slug': slug } })

  const createDraft = () =>
    service.client.post(
      '/v1/outreach/serve/sms',
      {
        name: 'Flood block renters',
        message: 'this is Bryan, your City Council Member. Is it the drains?',
        scheduledLocalDate: format(
          addBusinessDays(new Date(), 5),
          'yyyy-MM-dd',
        ),
        voterFileFilterId: filterId,
        proposalKey: PROPOSAL_KEY,
        priorityId,
        stepId: 'define',
        side: 'main',
      },
      headers(),
    )

  const defineCheck = async () =>
    parsePriorityStatus(
      (
        await service.prisma.priority.findUniqueOrThrow({
          where: { id: priorityId },
        })
      ).status,
    ).steps.find((step) => step.id === 'define')?.check

  it('reads as unsent until paid, then puts the check out and cannot be paid twice', async () => {
    const abandoned = await createDraft()
    expect(abandoned.status).toBe(HttpStatus.CREATED)
    // Going back from checkout and through again makes a fresh draft, and
    // the key moves to it.
    const draft = await createDraft()
    expect(draft.status).toBe(HttpStatus.CREATED)
    expect(
      await service.prisma.outreach.findUniqueOrThrow({
        where: { id: abandoned.data.outreachId },
      }),
    ).toMatchObject({ proposalKey: null })
    expect(
      await service.prisma.outreach.findUniqueOrThrow({
        where: { id: draft.data.outreachId },
      }),
    ).toMatchObject({
      proposalKey: PROPOSAL_KEY,
      priorityId,
      priorityStepId: 'define',
      priorityCheckSide: 'main',
      status: OutreachStatus.pending_payment,
    })

    const unpaid = await service.client.get(
      `/v1/outreach/by-proposal-key/${PROPOSAL_KEY}`,
      headers(),
    )
    expect(unpaid.status).toBe(HttpStatus.NOT_FOUND)
    expect(await defineCheck()).toMatchObject({ state: 'asked' })

    await service.app
      .get(OutreachServeSmsPurchaseHandlerService)
      .executePostPurchase('cs_test_sms', {
        outreachId: String(draft.data.outreachId),
        organizationSlug: slug,
      })

    const check = await defineCheck()
    expect(check).toMatchObject({
      state: 'out',
      sentProposalKey: PROPOSAL_KEY,
      sentAt: expect.any(String),
    })
    const paid = await service.client.get(
      `/v1/outreach/by-proposal-key/${PROPOSAL_KEY}`,
      headers(),
    )
    expect(paid.status).toBe(HttpStatus.OK)
    expect(paid.data.id).toBe(draft.data.outreachId)

    const again = await createDraft()
    expect(again.status).toBe(HttpStatus.CONFLICT)
  })
})
