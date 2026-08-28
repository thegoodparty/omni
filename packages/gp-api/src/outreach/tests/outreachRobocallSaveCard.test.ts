import { HttpStatus } from '@nestjs/common'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import Stripe from 'stripe'
import { useTestService } from '@/test-service'
import { StripeService } from '@/vendors/stripe/services/stripe.service'
import { UsersService } from '@/users/services/users.service'
import { Campaign } from '../../generated/prisma'

const service = useTestService()

const customersCreate = vi.fn()
const setupIntentsCreate = vi.fn()

let campaign: Campaign
let orgSlug: string

beforeEach(async () => {
  const stripe = service.app.get(StripeService)
  const stripeClient = (stripe as unknown as { stripe: Stripe }).stripe
  vi.spyOn(stripeClient.customers, 'create').mockImplementation(customersCreate)
  vi.spyOn(stripeClient.setupIntents, 'create').mockImplementation(
    setupIntentsCreate,
  )

  const campaignId = 997
  orgSlug = `campaign-${campaignId}`

  await service.prisma.organization.create({
    data: { slug: orgSlug, ownerId: service.user.id, positionId: 'pos-1' },
  })

  campaign = await service.prisma.campaign.create({
    data: {
      id: campaignId,
      organizationSlug: orgSlug,
      userId: service.user.id,
      slug: 'jane-doe',
      isPro: true,
      details: { state: 'TX', city: 'Georgetown', zip: '78634' },
      data: {},
      aiContent: {},
    },
  })
})

const orgHeaders = () => ({ headers: { 'x-organization-slug': orgSlug } })

const postSaveCard = () =>
  service.client.post(
    '/v1/outreach/robocall/save-card-intent',
    {},
    orgHeaders(),
  )

const setUserMetaData = (metaData: PrismaJson.UserMetaData) =>
  service.prisma.user.update({
    where: { id: service.user.id },
    data: { metaData },
  })

describe('POST /v1/outreach/robocall/save-card-intent', () => {
  it('creates and persists a customer, then returns a setup-intent secret', async () => {
    await setUserMetaData({ customerId: undefined })
    const setCasSpy = vi.spyOn(
      service.app.get(UsersService),
      'setCustomerIdIfAbsent',
    )
    customersCreate.mockResolvedValue({ id: 'cus_test_new' })
    setupIntentsCreate.mockResolvedValue({
      id: 'seti_test_1',
      client_secret: 'seti_test_secret',
    })

    const res = await postSaveCard()

    expect(res.status).toBe(HttpStatus.CREATED)
    expect(res.data).toEqual({
      clientSecret: 'seti_test_secret',
      customerId: 'cus_test_new',
    })

    expect(customersCreate).toHaveBeenCalledTimes(1)
    const customerArgs = customersCreate.mock.calls[0]?.[0]
    expect(customerArgs.metadata).toEqual({ userId: String(service.user.id) })

    // The winning path persists through the set-if-absent CAS exactly once.
    expect(setCasSpy).toHaveBeenCalledTimes(1)

    // The setup intent must be off_session so the later robocall charge is
    // pre-authenticated, must target the customer just created, and must be
    // pinned to cards only (a vaulted bank debit would settle as ACH).
    const setupArgs = setupIntentsCreate.mock.calls[0]?.[0]
    expect(setupArgs.customer).toBe('cus_test_new')
    expect(setupArgs.usage).toBe('off_session')
    expect(setupArgs.payment_method_types).toEqual(['card'])
    // Customer-scoped idempotency key so refresh/retry reuses the intent.
    const setupOpts = setupIntentsCreate.mock.calls[0]?.[1]
    expect(setupOpts.idempotencyKey).toBe('setup-intent-cus_test_new')

    const persisted = await service.prisma.user.findUniqueOrThrow({
      where: { id: service.user.id },
    })
    expect(persisted.metaData?.customerId).toBe('cus_test_new')
  })

  it('loses the CAS race: deletes the orphan and returns the stored winner', async () => {
    // A concurrent request already stored the winning customerId in the DB,
    // but this request read its user row before that write, so its in-hand
    // user still has no customerId and it proceeds to create.
    await setUserMetaData({ customerId: 'cus_winner' })
    const staleUser = { ...service.user, metaData: {} }

    const stripe = service.app.get(StripeService)
    vi.spyOn(
      service.app.get(UsersService),
      'setCustomerIdIfAbsent',
    ).mockResolvedValue(false)
    customersCreate.mockResolvedValue({ id: 'cus_orphan' })
    const customersDel = vi.fn().mockResolvedValue({ deleted: true })
    const stripeClient = (stripe as unknown as { stripe: Stripe }).stripe
    vi.spyOn(stripeClient.customers, 'del').mockImplementation(customersDel)

    const result = await stripe.ensureCustomer(staleUser)

    expect(result).toBe('cus_winner')
    expect(customersCreate).toHaveBeenCalledTimes(1)
    expect(customersDel).toHaveBeenCalledWith('cus_orphan')
  })

  it('reuses the stored customer and never creates a second one', async () => {
    await setUserMetaData({ customerId: 'cus_existing' })
    setupIntentsCreate.mockResolvedValue({
      id: 'seti_test_2',
      client_secret: 'seti_reuse_secret',
    })

    const res = await postSaveCard()

    expect(res.status).toBe(HttpStatus.CREATED)
    expect(res.data).toEqual({
      clientSecret: 'seti_reuse_secret',
      customerId: 'cus_existing',
    })
    expect(customersCreate).not.toHaveBeenCalled()
    expect(setupIntentsCreate.mock.calls[0]?.[0]?.customer).toBe('cus_existing')
  })

  it('rejects a non-Pro campaign without touching Stripe', async () => {
    await service.prisma.campaign.update({
      where: { id: campaign.id },
      data: { isPro: false },
    })

    const res = await postSaveCard()

    expect(res.status).toBe(HttpStatus.BAD_REQUEST)
    expect(customersCreate).not.toHaveBeenCalled()
    expect(setupIntentsCreate).not.toHaveBeenCalled()
  })

  it('maps a Stripe customer-create failure to 502', async () => {
    await setUserMetaData({ customerId: undefined })
    customersCreate.mockRejectedValue(new Error('stripe down'))

    const res = await postSaveCard()

    expect(res.status).toBe(HttpStatus.BAD_GATEWAY)
    expect(setupIntentsCreate).not.toHaveBeenCalled()
  })

  it('maps a Stripe setup-intent failure to 502', async () => {
    await setUserMetaData({ customerId: 'cus_existing' })
    setupIntentsCreate.mockRejectedValue(new Error('stripe down'))

    const res = await postSaveCard()

    expect(res.status).toBe(HttpStatus.BAD_GATEWAY)
  })
})
