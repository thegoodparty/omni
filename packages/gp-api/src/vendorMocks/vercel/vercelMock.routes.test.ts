import { HttpStatus } from '@nestjs/common'
import { Vercel } from '@vercel/sdk'
import { AddProjectDomainResponseBody$inboundSchema } from '@vercel/sdk/models/addprojectdomainop'
import { BuySingleDomainResponseBody$inboundSchema } from '@vercel/sdk/models/buysingledomainop'
import { GetDomainResponseBody$inboundSchema } from '@vercel/sdk/models/getdomainop'
import { GetDomainsResponseBody$inboundSchema } from '@vercel/sdk/models/getdomainsop'
import { GetOrderResponseBody$inboundSchema } from '@vercel/sdk/models/getorderop'
import { GetProjectDomainResponseBody$inboundSchema } from '@vercel/sdk/models/getprojectdomainop'
import { GetRecordsResponseBody$inboundSchema } from '@vercel/sdk/models/getrecordsop'
import { VerifyProjectDomainResponseBody$inboundSchema } from '@vercel/sdk/models/verifyprojectdomainop'
import { VendorMockVendor } from '@/generated/prisma'
import { TestFixturesService } from '@/testFixtures/services/testFixtures.service'
import { useTestService } from '@/test-service'
import {
  VercelBuyResponseSchema,
  VercelCreateRecordResponseSchema,
  VercelGetDomainResponseSchema,
  VercelGetDomainsResponseSchema,
  VercelGetRecordsResponseSchema,
  VercelOrderResponseSchema,
  VercelPriceResponseSchema,
  VercelProjectDomainResponseSchema,
} from '@/vendors/vercel/schemas/vercelMock.schema'
import { z } from 'zod'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  appEnvOverrides,
  useAppEnvOverrides,
} from '@/shared/test-utils/appEnvOverrides'

useAppEnvOverrides({ IS_NON_PROD_DEPLOY: true, VENDOR_MODE: 'mock' })

const service = useTestService()

const BASE = '/v1/vendor-mocks/vercel'
const AUTH = { headers: { Authorization: 'Bearer mock-token' } }
const DOMAIN = 'jane-for-mayor.com'
const PROJECT = 'prj_mock'

const sdk = () =>
  new Vercel({
    bearerToken: 'mock-token',
    serverURL: `${String(service.client.defaults.baseURL)}${BASE}`,
  })

const createDomainRow = async (name: string) => {
  const slug = `vercel-mock-${name}`
  await service.prisma.organization.create({
    data: { slug, ownerId: service.user.id },
  })
  const campaign = await service.prisma.campaign.create({
    data: {
      userId: service.user.id,
      slug,
      organizationSlug: slug,
      data: {},
      details: {},
      aiContent: {},
    },
  })
  const website = await service.prisma.website.create({
    data: { campaignId: campaign.id, vanityPath: slug },
  })
  await service.prisma.domain.create({
    data: { name, websiteId: website.id },
  })
  return campaign.id
}

const backdateOrders = () =>
  service.prisma.vendorMockRecord.updateMany({
    where: { vendor: VendorMockVendor.vercel, kind: 'domain_order' },
    data: { createdAt: new Date(Date.now() - 31_000) },
  })

const buy = (domain = DOMAIN) =>
  sdk().domainsRegistrar.buySingleDomain({
    domain,
    requestBody: {
      autoRenew: true,
      years: 1,
      expectedPrice: 13,
      contactInformation: {
        firstName: 'Jane',
        lastName: 'Doe',
        email: 'jane@example.com',
        phone: '+15555550100',
        address1: '1 Main St',
        city: 'Austin',
        state: 'TX',
        zip: '78701',
        country: 'US',
      },
    },
  })

describe('Vercel mock', () => {
  beforeEach(() => {
    appEnvOverrides.VENDOR_MODE = 'mock'
  })

  it('returns 404 when VENDOR_MODE is live', async () => {
    appEnvOverrides.VENDOR_MODE = 'live'
    const res = await service.client.get(`${BASE}/v5/domains`, AUTH)
    expect(res.status).toBe(HttpStatus.NOT_FOUND)
  })

  it('rejects a missing Authorization header with Vercel 403 shape', async () => {
    const res = await fetch(
      `${String(service.client.defaults.baseURL)}${BASE}/v5/domains`,
    )
    expect(res.status).toBe(HttpStatus.FORBIDDEN)
    const body = z
      .object({ error: z.object({ code: z.string() }) })
      .parse(await res.json())
    expect(body.error.code).toBe('forbidden')
  })

  it('serves price in the SDK shape', async () => {
    const price = await sdk().domainsRegistrar.getDomainPrice({
      domain: DOMAIN,
    })
    expect(price.purchasePrice).toBe(13)
    expect(price.renewalPrice).toBe(13)
    const raw = await service.client.get(
      `${BASE}/v1/registrar/domains/${DOMAIN}/price`,
      AUTH,
    )
    VercelPriceResponseSchema.parse(raw.data)
  })

  it('serves a fixed auth code', async () => {
    const { authCode } = await sdk().domainsRegistrar.getDomainAuthCode({
      domain: DOMAIN,
    })
    expect(authCode).toBeTruthy()
  })

  it('buy, pending order, backdated order completed, then getDomain', async () => {
    const campaignId = await createDomainRow(DOMAIN)
    const bought = await buy()
    expect(bought.orderId).toBeTruthy()

    const pending = await sdk().domainsRegistrar.getOrder({
      orderId: bought.orderId,
    })
    expect(pending.status).toBe('purchasing')
    await expect(
      sdk().domains.getDomain({ domain: DOMAIN }),
    ).rejects.toMatchObject({ statusCode: 404 })

    await backdateOrders()
    const done = await sdk().domainsRegistrar.getOrder({
      orderId: bought.orderId,
    })
    expect(done.status).toBe('completed')

    const { domain } = await sdk().domains.getDomain({ domain: DOMAIN })
    expect(domain.name).toBe(DOMAIN)
    expect(domain.boughtAt).not.toBeNull()
    const list = await sdk().domains.getDomains({})
    expect(list.domains.map((d) => d.name)).toEqual([DOMAIN])

    const rawBuy = await service.client.post(
      `${BASE}/v1/registrar/domains/${DOMAIN}/buy`,
      {},
      AUTH,
    )
    BuySingleDomainResponseBody$inboundSchema.parse(rawBuy.data)
    VercelBuyResponseSchema.parse(rawBuy.data)
    const rawOrder = await service.client.get(
      `${BASE}/v1/registrar/orders/${bought.orderId}`,
      AUTH,
    )
    GetOrderResponseBody$inboundSchema.parse(rawOrder.data)
    VercelOrderResponseSchema.parse(rawOrder.data)
    const rawDomain = await service.client.get(
      `${BASE}/v5/domains/${DOMAIN}`,
      AUTH,
    )
    GetDomainResponseBody$inboundSchema.parse(rawDomain.data)
    VercelGetDomainResponseSchema.parse(rawDomain.data)
    const rawDomains = await service.client.get(`${BASE}/v5/domains`, AUTH)
    GetDomainsResponseBody$inboundSchema.parse(rawDomains.data)
    VercelGetDomainsResponseSchema.parse(rawDomains.data)

    const records = await service.app
      .get(TestFixturesService)
      .getMockRecords(campaignId)
    expect(records.records.some((r) => r.kind === 'domain_order')).toBe(true)
  })

  it('vercel.order.fail makes an in-flight order failed', async () => {
    const campaignId = await createDomainRow(DOMAIN)
    const bought = await buy()
    await service.app
      .get(TestFixturesService)
      .applyMockAction({ campaignId, action: 'vercel.order.fail' })
    await backdateOrders()
    const order = await sdk().domainsRegistrar.getOrder({
      orderId: bought.orderId,
    })
    expect(order.status).toBe('failed')
  })

  it('vercel.order.fail applied before the buy fails the next order once', async () => {
    const campaignId = await createDomainRow(DOMAIN)
    await service.app
      .get(TestFixturesService)
      .applyMockAction({ campaignId, action: 'vercel.order.fail' })
    const first = await buy()
    const order = await sdk().domainsRegistrar.getOrder({
      orderId: first.orderId,
    })
    expect(order.status).toBe('failed')
    const retry = await buy()
    const retried = await sdk().domainsRegistrar.getOrder({
      orderId: retry.orderId,
    })
    expect(retried.status).toBe('purchasing')
  })

  it('project domain add, get, verify, remove', async () => {
    await expect(
      sdk().projects.getProjectDomain({ idOrName: PROJECT, domain: DOMAIN }),
    ).rejects.toMatchObject({ statusCode: 404 })

    const added = await sdk().projects.addProjectDomain({
      idOrName: PROJECT,
      requestBody: { name: DOMAIN },
    })
    expect(added.name).toBe(DOMAIN)
    const got = await sdk().projects.getProjectDomain({
      idOrName: PROJECT,
      domain: DOMAIN,
    })
    expect(got.projectId).toBe(PROJECT)
    const verified = await sdk().projects.verifyProjectDomain({
      idOrName: PROJECT,
      domain: DOMAIN,
    })
    expect(verified.verified).toBe(true)

    for (const [schema, path, method] of [
      [
        AddProjectDomainResponseBody$inboundSchema,
        `v10/projects/${PROJECT}/domains`,
        'post',
      ],
      [
        GetProjectDomainResponseBody$inboundSchema,
        `v9/projects/${PROJECT}/domains/${DOMAIN}`,
        'get',
      ],
      [
        VerifyProjectDomainResponseBody$inboundSchema,
        `v9/projects/${PROJECT}/domains/${DOMAIN}/verify`,
        'post',
      ],
    ] as const) {
      const res =
        method === 'post'
          ? await service.client.post(`${BASE}/${path}`, { name: DOMAIN }, AUTH)
          : await service.client.get(`${BASE}/${path}`, AUTH)
      schema.parse(res.data)
      VercelProjectDomainResponseSchema.parse(res.data)
    }

    await sdk().projects.removeProjectDomain({
      idOrName: PROJECT,
      domain: DOMAIN,
    })
    await expect(
      sdk().projects.getProjectDomain({ idOrName: PROJECT, domain: DOMAIN }),
    ).rejects.toMatchObject({ statusCode: 404 })
  })

  it('createRecord then getRecords returns it', async () => {
    const campaignId = await createDomainRow(DOMAIN)
    const created = await sdk().dns.createRecord({
      domain: DOMAIN,
      requestBody: {
        type: 'MX',
        name: '',
        value: 'mx1.forwardemail.net',
        mxPriority: 10,
        ttl: 60,
      },
    })
    expect(created).toHaveProperty('uid')
    await sdk().dns.createRecord({
      domain: 'other.com',
      requestBody: { type: 'TXT', name: '', value: 'x', ttl: 60 },
    })

    const raw = await service.client.get(
      `${BASE}/v5/domains/${DOMAIN}/records`,
      AUTH,
    )
    GetRecordsResponseBody$inboundSchema.parse(raw.data)
    VercelGetRecordsResponseSchema.parse(raw.data)
    const res = await sdk().dns.getRecords({ domain: DOMAIN })
    expect(typeof res).not.toBe('string')
    expect(res).toMatchObject({
      records: [
        { type: 'MX', name: '', value: 'mx1.forwardemail.net', mxPriority: 10 },
      ],
    })
    const rawCreate = await service.client.post(
      `${BASE}/v2/domains/${DOMAIN}/records`,
      { type: 'TXT', name: '', value: 'v' },
      AUTH,
    )
    VercelCreateRecordResponseSchema.parse(rawCreate.data)

    const mock = await service.app
      .get(TestFixturesService)
      .getMockRecords(campaignId)
    expect(mock.records.filter((r) => r.kind === 'dns_record')).toHaveLength(
      3 - 1,
    )
  })
})
