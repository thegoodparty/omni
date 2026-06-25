import { Test, TestingModule } from '@nestjs/testing'
import { DiscoveryModule, HttpAdapterHost, Reflector } from '@nestjs/core'
import {
  ConflictException,
  HttpStatus,
  ModuleMetadata,
  NotFoundException,
  RequestMethod,
} from '@nestjs/common'
import { DomainSource, DomainStatus } from '../../generated/prisma'
import { IncomingRequest } from '@/authentication/authentication.types'
import { PinoLogger } from 'nestjs-pino'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DomainsController } from './domains.controller'
import { DomainsService } from '../services/domains.service'
import { WebsitesService } from '../services/websites.service'
import { UseCampaignGuard } from 'src/campaigns/guards/UseCampaign.guard'
import { REQUIRE_CAMPAIGN_META_KEY } from 'src/campaigns/decorators/UseCampaign.decorator'
import { MCP_TOOL_KEY } from '@/mcp/decorators/McpTool.decorator'
import { McpServerService } from '@/mcp/services/mcpServer.service'
import { AgentMcpMarker } from '@/authentication/agentMcpMarker'
import {
  PurchaseDomainBodySchema,
  PurchaseDomainResponseSchema,
} from '../schemas/PurchaseDomain.schema'
import {
  createMockCampaign,
  createMockUser,
} from '@/shared/test-utils/mockData.util'
import { createMockLogger } from '@/shared/test-utils/mockLogger.util'

describe('DomainsController.searchDomains', () => {
  let controller: DomainsController
  let mockDomains: { searchDomainsForCampaign: ReturnType<typeof vi.fn> }

  beforeEach(async () => {
    mockDomains = {
      searchDomainsForCampaign: vi.fn().mockResolvedValue({
        candidates: [{ domain: 'vote-oneill.run', price: 8 }],
      }),
    }

    const module: TestingModule = await Test.createTestingModule({
      controllers: [DomainsController],
      providers: [
        { provide: DomainsService, useValue: mockDomains },
        { provide: WebsitesService, useValue: {} },
      ],
    })
      .overrideGuard(UseCampaignGuard)
      .useValue({ canActivate: () => true })
      .compile()

    controller = module.get<DomainsController>(DomainsController)
  })

  it('delegates to DomainsService.searchDomainsForCampaign and returns its result', async () => {
    const campaign = {
      ...createMockCampaign({ details: { electionDate: '2026-11-03' } }),
      user: createMockUser({ firstName: 'Mary', lastName: "O'Neill" }),
    }

    const result = await controller.searchDomains(campaign, {
      patterns: ['vote-{last_name}.run'],
      maxPrice: 10,
    })

    expect(mockDomains.searchDomainsForCampaign).toHaveBeenCalledWith(
      campaign,
      ['vote-{last_name}.run'],
      10,
    )
    expect(result).toEqual({
      candidates: [{ domain: 'vote-oneill.run', price: 8 }],
    })
  })

  it('handler is registered for POST /search with @UseCampaign() including user', () => {
    const reflector = new Reflector()

    const path = Reflect.getMetadata('path', controller.searchDomains)
    const method = Reflect.getMetadata('method', controller.searchDomains)
    expect(path).toBe('search')
    expect(method).toBe(RequestMethod.POST)

    const meta = reflector.get(
      REQUIRE_CAMPAIGN_META_KEY,
      controller.searchDomains,
    )
    expect(meta).toBeDefined()
    expect(meta.include).toEqual({ user: true })
  })
})

describe('DomainsController.purchaseDomain', () => {
  let controller: DomainsController
  let mockDomains: { purchaseDomainForCampaign: ReturnType<typeof vi.fn> }

  beforeEach(async () => {
    mockDomains = {
      purchaseDomainForCampaign: vi.fn().mockResolvedValue({
        website: {
          id: 42,
          vanityPath: 'jane-for-senate',
          status: 'unpublished',
          campaignId: 7,
        },
        domain: {
          id: 99,
          name: 'voteforjane.run',
          status: DomainStatus.submitted,
          price: 8,
        },
        alreadyExisted: false,
        message: 'Domain registration submitted',
      }),
    }

    const module: TestingModule = await Test.createTestingModule({
      controllers: [DomainsController],
      providers: [
        { provide: DomainsService, useValue: mockDomains },
        { provide: WebsitesService, useValue: {} },
      ],
    })
      .overrideGuard(UseCampaignGuard)
      .useValue({ canActivate: () => true })
      .compile()

    controller = module.get<DomainsController>(DomainsController)
  })

  it('delegates to DomainsService.purchaseDomainForCampaign and narrows the response (drops website)', async () => {
    const campaign = {
      ...createMockCampaign({ details: { electionDate: '2026-11-03' } }),
      user: createMockUser({ firstName: 'Jane', lastName: 'Doe' }),
    }

    const result = await controller.purchaseDomain(
      campaign,
      {
        domain: 'voteforjane.run',
        maxPrice: 50,
      },
      {} as IncomingRequest,
    )

    expect(mockDomains.purchaseDomainForCampaign).toHaveBeenCalledWith(
      campaign,
      'voteforjane.run',
      50,
      DomainSource.manual,
    )
    expect(result).toEqual({
      domain: {
        id: 99,
        name: 'voteforjane.run',
        status: DomainStatus.submitted,
        price: 8,
      },
      alreadyExisted: false,
      message: 'Domain registration submitted',
    })
    expect(result).not.toHaveProperty('website')
  })

  it('propagates ConflictException from the service when the domain is no longer available', async () => {
    mockDomains.purchaseDomainForCampaign.mockRejectedValueOnce(
      new ConflictException('Domain voteforjane.run is no longer available'),
    )

    const campaign = {
      ...createMockCampaign({ details: { electionDate: '2026-11-03' } }),
      user: createMockUser({ firstName: 'Jane', lastName: 'Doe' }),
    }

    await expect(
      controller.purchaseDomain(
        campaign,
        {
          domain: 'voteforjane.run',
          maxPrice: 50,
        },
        {} as IncomingRequest,
      ),
    ).rejects.toBeInstanceOf(ConflictException)
  })

  it.each([
    { agentToken: true, expected: DomainSource.agentic },
    { agentToken: false, expected: DomainSource.manual },
  ])(
    'derives source from req.agentToken=$agentToken and passes it to the service',
    async ({ agentToken, expected }) => {
      const campaign = {
        ...createMockCampaign({ details: { electionDate: '2026-11-03' } }),
        user: createMockUser({ firstName: 'Jane', lastName: 'Doe' }),
      }

      await controller.purchaseDomain(
        campaign,
        { domain: 'voteforjane.run', maxPrice: 50 },
        { agentToken } as IncomingRequest,
      )

      expect(mockDomains.purchaseDomainForCampaign).toHaveBeenCalledWith(
        campaign,
        'voteforjane.run',
        50,
        expected,
      )
    },
  )

  it('handler is registered for POST /purchase with @UseCampaign() including user, @HttpCode(202), and @McpTool description', () => {
    const reflector = new Reflector()

    const path = Reflect.getMetadata('path', controller.purchaseDomain)
    const method = Reflect.getMetadata('method', controller.purchaseDomain)
    expect(path).toBe('purchase')
    expect(method).toBe(RequestMethod.POST)

    const statusCode = Reflect.getMetadata(
      '__httpCode__',
      controller.purchaseDomain,
    )
    expect(statusCode).toBe(HttpStatus.ACCEPTED)

    const useCampaignMeta = reflector.get(
      REQUIRE_CAMPAIGN_META_KEY,
      controller.purchaseDomain,
    )
    expect(useCampaignMeta).toBeDefined()
    expect(useCampaignMeta.include).toEqual({ user: true })

    const mcpMeta = reflector.get(MCP_TOOL_KEY, controller.purchaseDomain)
    expect(mcpMeta).toBeDefined()
    expect(mcpMeta.description).toMatch(/Purchase a specific available domain/)
  })

  it('PurchaseDomainBodySchema enforces server-side maxPrice ceiling', () => {
    const validResult = PurchaseDomainBodySchema.schema.safeParse({
      domain: 'voteforjane.run',
      maxPrice: 50,
    })
    expect(validResult.success).toBe(true)

    const overCeilingResult = PurchaseDomainBodySchema.schema.safeParse({
      domain: 'voteforjane.run',
      maxPrice: 200,
    })
    expect(overCeilingResult.success).toBe(false)
  })

  it('PurchaseDomainBodySchema rejects domains outside the TLD allowlist', () => {
    const approved = PurchaseDomainBodySchema.schema.safeParse({
      domain: 'voteforjane.site',
      maxPrice: 50,
    })
    expect(approved.success).toBe(true)

    for (const domain of ['voteforjane.com', 'voteforjane.org']) {
      const result = PurchaseDomainBodySchema.schema.safeParse({
        domain,
        maxPrice: 50,
      })
      expect(result.success).toBe(false)
    }
  })
})

describe('DomainsController.purchaseDomain MCP discoverability', () => {
  const buildModule = (): ModuleMetadata => ({
    imports: [DiscoveryModule],
    controllers: [DomainsController],
    providers: [
      McpServerService,
      AgentMcpMarker,
      { provide: DomainsService, useValue: {} },
      { provide: WebsitesService, useValue: {} },
      {
        provide: HttpAdapterHost,
        useValue: {
          httpAdapter: {
            getInstance: () => ({
              inject: async () => ({
                statusCode: 200,
                body: '{}',
                headers: {},
              }),
            }),
          },
        },
      },
      { provide: PinoLogger, useValue: createMockLogger() },
    ],
  })

  it('appears in gatherTools() output with name POST_domains_purchase, full input/output schemas, and accurate description', async () => {
    const moduleRef = await Test.createTestingModule(buildModule())
      .overrideGuard(UseCampaignGuard)
      .useValue({ canActivate: () => true })
      .compile()
    await moduleRef.init()

    const tools = moduleRef.get(McpServerService).getTools()
    const purchase = tools.find((t) => t.toolName === 'POST_domains_purchase')

    expect(purchase).toBeDefined()
    expect(purchase!.description).toMatch(
      /Purchase a specific available domain/,
    )
    expect(purchase!.description).toMatch(/Poll GET \/v1\/domains\/status/)
    expect(purchase!.outputSchema).toBe(PurchaseDomainResponseSchema)
    expect(purchase!.inputDeclarations.body.declared).toBe(true)
    expect(purchase!.inputDeclarations.body.schema).toBe(
      PurchaseDomainBodySchema.schema,
    )
    expect(purchase!.inputDeclarations.query.declared).toBe(false)
    expect(purchase!.inputDeclarations.params.declared).toBe(false)
  })
})

describe('DomainsController.configureDomain', () => {
  let controller: DomainsController
  let mockDomains: { configureDomain: ReturnType<typeof vi.fn> }
  let mockWebsites: { findUnique: ReturnType<typeof vi.fn> }

  beforeEach(async () => {
    mockDomains = {
      configureDomain: vi.fn().mockResolvedValue({
        domain: 'voteforjane.run',
        status: 'configured',
        message: 'Domain configured successfully with Vercel',
      }),
    }
    mockWebsites = {
      findUnique: vi.fn().mockResolvedValue({ id: 42 }),
    }

    const module: TestingModule = await Test.createTestingModule({
      controllers: [DomainsController],
      providers: [
        { provide: DomainsService, useValue: mockDomains },
        { provide: WebsitesService, useValue: mockWebsites },
      ],
    })
      .overrideGuard(UseCampaignGuard)
      .useValue({ canActivate: () => true })
      .compile()

    controller = module.get<DomainsController>(DomainsController)
  })

  it('resolves the website from the caller campaign and configures by website.id, never the campaign id', async () => {
    // campaign.id (7) and website.id (42) are deliberately different. The bug
    // passed campaignId where a websiteId is expected, so configureDomain
    // resolved whichever tenant's Domain happened to have websiteId === 7.
    // The fix must look the website up by campaignId first and configure that
    // website's own id.
    const campaign = { ...createMockCampaign(), id: 7 }

    const result = await controller.configureDomain(campaign)

    expect(mockWebsites.findUnique).toHaveBeenCalledWith({
      where: { campaignId: 7 },
      select: { id: true },
    })
    expect(mockDomains.configureDomain).toHaveBeenCalledWith(42)
    expect(mockDomains.configureDomain).not.toHaveBeenCalledWith(7)
    expect(result).toEqual({
      domain: 'voteforjane.run',
      status: 'configured',
      message: 'Domain configured successfully with Vercel',
    })
  })

  it('throws NotFoundException and never configures when the caller has no website', async () => {
    mockWebsites.findUnique.mockResolvedValue(null)
    const campaign = { ...createMockCampaign(), id: 7 }

    await expect(controller.configureDomain(campaign)).rejects.toBeInstanceOf(
      NotFoundException,
    )
    expect(mockDomains.configureDomain).not.toHaveBeenCalled()
  })

  it('handler is registered for POST /configure with @UseCampaign()', () => {
    // Guards the IDOR fix: @UseCampaign() is what binds the request to the
    // caller's own campaign. Dropping it would leave every other test green
    // while silently re-exposing the cross-tenant path this PR closed.
    const reflector = new Reflector()

    const path = Reflect.getMetadata('path', controller.configureDomain)
    const method = Reflect.getMetadata('method', controller.configureDomain)
    expect(path).toBe('configure')
    expect(method).toBe(RequestMethod.POST)

    const meta = reflector.get(
      REQUIRE_CAMPAIGN_META_KEY,
      controller.configureDomain,
    )
    expect(meta).toBeDefined()
  })
})
