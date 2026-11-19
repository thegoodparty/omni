import { PublicAccess } from '@/authentication/decorators/PublicAccess.decorator'
import { VENDOR_MODE } from '@/shared/util/appEnvironment.util'
import { VendorMockVendor } from '@/generated/prisma'
import {
  VERCEL_ORDER_STATUS,
  VercelAddProjectDomainRequestSchema,
  VercelBuyRequestSchema,
  VercelCreateDnsRecordRequestSchema,
  VercelDnsRecordStateSchema,
  VercelProjectDomainStateSchema,
  type VercelDomain,
} from '@/vendors/vercel/schemas/vercelMock.schema'
import type { VercelProjectDomainState } from '@/vendors/vercel/schemas/vercelMock.schema'
import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Post,
  BadRequestException,
} from '@nestjs/common'
import { randomUUID } from 'crypto'
import { addYears } from 'date-fns'
import { VendorMockRecordService } from '../vendorMockRecord.service'

const VERCEL_PROJECT_ID = 'mock-project'
const VERCEL_MOCK_USER_ID = 'mock-user'
const MOCK_PURCHASE_PRICE = 13
const MOCK_RENEWAL_PRICE = 13
const MOCK_TRANSFER_PRICE = 13
const MOCK_AUTH_CODE = 'mock-auth-code'
const MOCK_NAMESERVERS = ['ns1.vercel-dns.com', 'ns2.vercel-dns.com']

const ORDER_KIND = 'domain_order'
const PROJECT_DOMAIN_KIND = 'project_domain'
const DNS_RECORD_KIND = 'dns_record'

// Vercel's error envelope: { error: { code, message } }.
const vercelError = (code: string, message: string) => ({
  error: { code, message },
})

@Controller('vendor-mocks/vercel')
@PublicAccess()
export class VercelMockController {
  constructor(private readonly vendorMockRecord: VendorMockRecordService) {}

  @Get('v9/projects/:idOrName/domains/:domain')
  async getProjectDomain(
    @Headers('authorization') auth: string | undefined,
    @Param('domain') domain: string,
  ) {
    this.assertMockMode()
    this.assertAuth(auth)
    const record = await this.vendorMockRecord.findUnique({
      where: {
        vendor_kind_externalId: {
          vendor: VendorMockVendor.vercel,
          kind: PROJECT_DOMAIN_KIND,
          externalId: domain,
        },
      },
    })
    if (!record) throw this.notFound(`Domain ${domain} not found on project`)
    return this.projectDomainBody(
      VercelProjectDomainStateSchema.parse(record.state),
    )
  }

  @Post('v10/projects/:idOrName/domains')
  @HttpCode(HttpStatus.OK)
  async addProjectDomain(
    @Headers('authorization') auth: string | undefined,
    @Param('idOrName') idOrName: string,
    @Body() body: unknown,
  ) {
    this.assertMockMode()
    this.assertAuth(auth)
    const parsed = VercelAddProjectDomainRequestSchema.safeParse(body)
    if (!parsed.success) throw new BadRequestException(parsed.error.message)
    const { name } = parsed.data
    const state: VercelProjectDomainState = {
      name,
      projectId: idOrName,
      // Domains bought through Vercel are verified on attach.
      verified: true,
      createdAt: Date.now(),
    }
    await this.vendorMockRecord.upsert(
      VendorMockVendor.vercel,
      PROJECT_DOMAIN_KIND,
      name,
      state,
      await this.vendorMockRecord.campaignIdForDomain(name),
      { name },
    )
    return this.projectDomainBody(state)
  }

  @Delete('v9/projects/:idOrName/domains/:domain')
  async removeProjectDomain(
    @Headers('authorization') auth: string | undefined,
    @Param('domain') domain: string,
  ) {
    this.assertMockMode()
    this.assertAuth(auth)
    await this.vendorMockRecord.removeVercelProjectDomain(domain)
    return {}
  }

  @Post('v9/projects/:idOrName/domains/:domain/verify')
  @HttpCode(HttpStatus.OK)
  async verifyProjectDomain(
    @Headers('authorization') auth: string | undefined,
    @Param('domain') domain: string,
  ) {
    this.assertMockMode()
    this.assertAuth(auth)
    const record = await this.vendorMockRecord.findUnique({
      where: {
        vendor_kind_externalId: {
          vendor: VendorMockVendor.vercel,
          kind: PROJECT_DOMAIN_KIND,
          externalId: domain,
        },
      },
    })
    if (!record) throw this.notFound(`Domain ${domain} not found on project`)
    await this.vendorMockRecord.setFlag(
      VendorMockVendor.vercel,
      PROJECT_DOMAIN_KIND,
      domain,
      'verified',
      true,
    )
    return this.projectDomainBody({
      ...VercelProjectDomainStateSchema.parse(record.state),
      verified: true,
    })
  }

  @Get('v1/registrar/domains/:domain/price')
  getDomainPrice(@Headers('authorization') auth: string | undefined) {
    this.assertMockMode()
    this.assertAuth(auth)
    return {
      years: 1,
      purchasePrice: MOCK_PURCHASE_PRICE,
      renewalPrice: MOCK_RENEWAL_PRICE,
      transferPrice: MOCK_TRANSFER_PRICE,
    }
  }

  @Post('v1/registrar/domains/:domain/buy')
  @HttpCode(HttpStatus.OK)
  async buySingleDomain(
    @Headers('authorization') auth: string | undefined,
    @Param('domain') domain: string,
    @Body() body: unknown,
  ) {
    this.assertMockMode()
    this.assertAuth(auth)
    const parsed = VercelBuyRequestSchema.safeParse(body ?? {})
    if (!parsed.success) throw new BadRequestException(parsed.error.message)
    const campaignId = await this.vendorMockRecord.campaignIdForDomain(domain)
    const armedToFail =
      campaignId !== undefined &&
      (await this.vendorMockRecord.consumeVercelOrderFail(campaignId))
    const orderId = `mock-order-${randomUUID()}`
    await this.vendorMockRecord.upsert(
      VendorMockVendor.vercel,
      ORDER_KIND,
      orderId,
      {
        domainName: domain,
        status: armedToFail
          ? VERCEL_ORDER_STATUS.failed
          : VERCEL_ORDER_STATUS.pending,
        price: parsed.data.expectedPrice ?? MOCK_PURCHASE_PRICE,
        years: parsed.data.years ?? 1,
        autoRenew: parsed.data.autoRenew ?? true,
        boughtAt: null,
      },
      campaignId,
      { domain },
    )
    return {
      orderId,
      // The wire key is `_links`; the SDK renames it to `links`.
      _links: {
        order: { href: `/v1/registrar/orders/${orderId}`, method: 'GET' },
      },
    }
  }

  @Get('v1/registrar/orders/:orderId')
  async getOrder(
    @Headers('authorization') auth: string | undefined,
    @Param('orderId') orderId: string,
  ) {
    this.assertMockMode()
    this.assertAuth(auth)
    const record = await this.vendorMockRecord.findUnique({
      where: {
        vendor_kind_externalId: {
          vendor: VendorMockVendor.vercel,
          kind: ORDER_KIND,
          externalId: orderId,
        },
      },
    })
    if (!record) throw this.notFound(`Order ${orderId} not found`)
    const state = await this.vendorMockRecord.resolveVercelOrder(record)
    return {
      orderId,
      // The SDK's top-level order status has no `pending`; its in-flight
      // value is `purchasing` (the per-domain status does use `pending`).
      status:
        state.status === VERCEL_ORDER_STATUS.pending
          ? 'purchasing'
          : state.status,
      domains: [
        {
          purchaseType: 'purchase',
          autoRenew: state.autoRenew,
          years: state.years,
          domainName: state.domainName,
          status: state.status,
          price: state.price,
        },
      ],
    }
  }

  @Get('v1/registrar/domains/:domain/auth-code')
  getDomainAuthCode(@Headers('authorization') auth: string | undefined) {
    this.assertMockMode()
    this.assertAuth(auth)
    return { authCode: MOCK_AUTH_CODE }
  }

  @Get('v5/domains/:domain')
  async getDomain(
    @Headers('authorization') auth: string | undefined,
    @Param('domain') domain: string,
  ) {
    this.assertMockMode()
    this.assertAuth(auth)
    const found = (await this.completedDomains()).find((d) => d.name === domain)
    if (!found) throw this.notFound(`Domain ${domain} not found`)
    return { domain: found }
  }

  @Get('v5/domains')
  async getDomains(@Headers('authorization') auth: string | undefined) {
    this.assertMockMode()
    this.assertAuth(auth)
    const domains = await this.completedDomains()
    return {
      domains,
      pagination: { count: domains.length, next: null, prev: null },
    }
  }

  @Get('v5/domains/:domain/records')
  async getDnsRecords(
    @Headers('authorization') auth: string | undefined,
    @Param('domain') domain: string,
  ) {
    this.assertMockMode()
    this.assertAuth(auth)
    const rows = await this.vendorMockRecord.findMany({
      where: {
        vendor: VendorMockVendor.vercel,
        kind: DNS_RECORD_KIND,
        state: { path: ['domain'], equals: domain },
      },
      orderBy: { createdAt: 'asc' },
    })
    const records = rows.map((row) => {
      const s = VercelDnsRecordStateSchema.parse(row.state)
      return {
        id: s.uid,
        slug: s.uid,
        name: s.name,
        type: s.type,
        value: s.value,
        ...(s.mxPriority !== undefined && { mxPriority: s.mxPriority }),
        ...(s.ttl !== undefined && { ttl: s.ttl }),
        creator: VERCEL_MOCK_USER_ID,
        created: s.createdAt,
        updated: s.createdAt,
        createdAt: s.createdAt,
        updatedAt: s.createdAt,
      }
    })
    return { records, pagination: { next: null } }
  }

  @Post('v2/domains/:domain/records')
  @HttpCode(HttpStatus.OK)
  async createDnsRecord(
    @Headers('authorization') auth: string | undefined,
    @Param('domain') domain: string,
    @Body() body: unknown,
  ) {
    this.assertMockMode()
    this.assertAuth(auth)
    const parsed = VercelCreateDnsRecordRequestSchema.safeParse(body)
    if (!parsed.success) throw new BadRequestException(parsed.error.message)
    const uid = `rec_${randomUUID()}`
    const now = Date.now()
    await this.vendorMockRecord.upsert(
      VendorMockVendor.vercel,
      DNS_RECORD_KIND,
      `${domain}/${uid}`,
      {
        domain,
        uid,
        type: parsed.data.type,
        name: parsed.data.name,
        value: parsed.data.value,
        ...(parsed.data.mxPriority !== undefined && {
          mxPriority: parsed.data.mxPriority,
        }),
        ...(parsed.data.ttl !== undefined && { ttl: parsed.data.ttl }),
        createdAt: now,
      },
      await this.vendorMockRecord.campaignIdForDomain(domain),
      parsed.data,
    )
    return { uid, updated: now }
  }

  private async completedDomains(): Promise<VercelDomain[]> {
    const rows = await this.vendorMockRecord.findMany({
      where: { vendor: VendorMockVendor.vercel, kind: ORDER_KIND },
      orderBy: { createdAt: 'asc' },
    })
    const byName = new Map<string, VercelDomain>()
    for (const row of rows) {
      const state = await this.vendorMockRecord.resolveVercelOrder(row)
      if (
        state.status !== VERCEL_ORDER_STATUS.completed ||
        state.boughtAt === null
      ) {
        continue
      }
      byName.set(state.domainName, {
        suffix: false,
        expiresAt: addYears(state.boughtAt, state.years).getTime(),
        verified: true,
        nameservers: MOCK_NAMESERVERS,
        intendedNameservers: MOCK_NAMESERVERS,
        creator: {
          username: 'mock-user',
          email: 'mock@goodparty.org',
          id: VERCEL_MOCK_USER_ID,
        },
        name: state.domainName,
        teamId: null,
        boughtAt: state.boughtAt,
        createdAt: state.boughtAt,
        id: `dom_${state.domainName}`,
        serviceType: 'zeit.world',
        userId: VERCEL_MOCK_USER_ID,
      })
    }
    return [...byName.values()]
  }

  private projectDomainBody(state: VercelProjectDomainState) {
    return {
      name: state.name,
      apexName: state.name,
      projectId: state.projectId || VERCEL_PROJECT_ID,
      verified: state.verified,
      createdAt: state.createdAt,
      updatedAt: state.createdAt,
    }
  }

  private notFound(message: string) {
    return new NotFoundException(vercelError('not_found', message))
  }

  // Any bearer token passes; a missing one gets Vercel's 403 shape.
  private assertAuth(auth: string | undefined) {
    if (!auth || !/^Bearer\s+\S+/i.test(auth)) {
      throw new ForbiddenException(
        vercelError('forbidden', 'Not authorized: missing bearer token'),
      )
    }
  }

  private assertMockMode() {
    if (VENDOR_MODE !== 'mock') throw new NotFoundException()
  }
}
