import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Post,
  Query,
  Req,
  UseGuards,
  UsePipes,
} from '@nestjs/common'
import { DomainsService } from '../services/domains.service'
import { PaymentStatus } from 'src/payments/payments.types'
import { ZodValidationPipe } from 'nestjs-zod'
import { SearchDomainSchema } from '../schemas/SearchDomain.schema'
import { DomainAuthCodeSchema } from '../schemas/DomainAuthCode.schema'
import {
  SearchDomainsBodySchema,
  SearchDomainsResponseSchema,
} from '../schemas/SearchDomains.schema'
import {
  PurchaseDomainBodySchema,
  PurchaseDomainResponseSchema,
} from '../schemas/PurchaseDomain.schema'
import { UseCampaign } from 'src/campaigns/decorators/UseCampaign.decorator'
import { ReqCampaign } from 'src/campaigns/decorators/ReqCampaign.decorator'
import {
  Campaign,
  DomainSource,
  DomainStatus,
  User,
  UserRole,
} from '../../generated/prisma'
import { IncomingRequest } from '@/authentication/authentication.types'
import { Roles } from 'src/authentication/decorators/Roles.decorator'
import { AdminOrM2MGuard } from '@/authentication/guards/AdminOrM2M.guard'
import { WebsitesService } from '../services/websites.service'
import {
  AuthCodeRequester,
  DomainOperationStatus,
  DomainOperationType,
  DomainStatusResponse,
  PatternedDomainSearchResult,
  SUPPORTED_TLDS,
} from '../domains.types'
import { ResponseSchema } from '@/shared/decorators/ResponseSchema.decorator'
import { McpTool } from '@/mcp/decorators/McpTool.decorator'

const NO_WEBSITE_FOUND_MESSAGE = 'No website found for this campaign'

@Controller('domains')
@UsePipes(ZodValidationPipe)
export class DomainsController {
  constructor(
    private readonly domains: DomainsService,
    private readonly websites: WebsitesService,
  ) {}

  @Get()
  @Roles(UserRole.admin)
  async domainDetails(@Query() { domain }: SearchDomainSchema) {
    return this.domains.getDomainDetails(domain)
  }

  // Lets support staff service a candidate's "transfer my domain out" request
  // without needing personal Owner access to the GoodParty Vercel team.
  //
  // AdminOrM2MGuard rather than @Roles(admin) so gp-admin can reach it at all:
  // gp-admin authenticates with an M2M machine token, which SessionGuard
  // short-circuits without populating a user, so RolesGuard can never pass for
  // it. Same guard the impersonation and sign-in-link routes already use — and
  // those mint a session as an arbitrary user, which is strictly more powerful
  // than a transfer code for a domain we can already prove we own.
  @Get('auth-code')
  @UseGuards(AdminOrM2MGuard)
  async domainAuthCode(
    @Req() req: IncomingRequest,
    @Query() { domain, actorEmail }: DomainAuthCodeSchema,
  ): Promise<{ authCode: string }> {
    return {
      authCode: await this.domains.getDomainTransferAuthCode(
        domain,
        this.resolveAuthCodeRequester(req, actorEmail),
      ),
    }
  }

  // Control of the domain leaves GoodParty when this code is issued, so it has
  // to be attributable to a person no matter which way the caller authenticated.
  private resolveAuthCodeRequester(
    req: IncomingRequest,
    actorEmail?: string,
  ): AuthCodeRequester {
    // Impersonated admin session. AdminOrM2MGuard admits it on the actor's
    // roles, so the actor is the accountable human — `req.user` would name the
    // candidate being impersonated.
    if (req.actorUser) {
      return {
        authSource: 'user',
        userId: req.actorUser.id,
        email: req.actorUser.email,
      }
    }

    // An act claim that never resolved to a local user cannot be attributed to
    // anyone, so refuse rather than record the wrong person.
    if (req.actorSub) {
      throw new ForbiddenException(
        'Cannot issue a domain transfer auth code for an impersonated ' +
          'session whose acting admin could not be identified',
      )
    }

    if (req.user) {
      return { authSource: 'user', userId: req.user.id, email: req.user.email }
    }

    // M2M. gp-admin knows who is signed in; gp-api cannot derive it from a
    // machine token, so the caller has to say. Unverified by construction —
    // it records which admin gp-admin says is acting, and gp-admin's own
    // permission check is what gates the call.
    if (!actorEmail) {
      throw new BadRequestException(
        'actorEmail is required when requesting a domain transfer auth code ' +
          'with a machine token',
      )
    }

    return { authSource: 'm2m', email: actorEmail }
  }

  @Get('search')
  async searchDomain(@Query() { domain }: SearchDomainSchema) {
    return this.domains.searchForDomain(domain)
  }

  @Post('search')
  @UseCampaign({ include: { user: true } })
  @HttpCode(HttpStatus.OK)
  @ResponseSchema(SearchDomainsResponseSchema)
  @McpTool({
    description:
      'Find available campaign domains for the calling campaign ' +
      'matching one or more name patterns, under a per-domain price ' +
      'cap. Only GoodParty-approved campaign TLDs are searched: ' +
      `${SUPPORTED_TLDS.map((tld) => `.${tld}`).join(' / ')} — ` +
      '.com/.org/.net are never offered. Use during the ' +
      "compliance_setup flow after the candidate's profile is saved, " +
      'to pick a domain before purchase. Patterns may be bare SLDs ' +
      '(e.g. ["janeforsenate", "voteforjane"]), which the server fans ' +
      'out across all approved TLDs, or include an explicit approved ' +
      'TLD (e.g. "janeforsenate.run"). Returns { candidates: ' +
      '[{ domain, price }] } for ranking. Returns only available ' +
      'domains, as a shortlist: the search stops early once enough ' +
      'candidates qualify, so it is not exhaustive. An empty ' +
      'candidates list is authoritative — every candidate was checked ' +
      'and none matched under the cap. If any candidate could not be ' +
      'checked (registrar rate limiting, time budget, or a pattern set ' +
      'larger than the per-search cap) and nothing else qualified, the ' +
      'call fails with a 502 rather than returning an empty list. ' +
      'Read-only; safe to retry.',
  })
  async searchDomains(
    @ReqCampaign() campaign: Campaign & { user: User },
    @Body() { patterns, maxPrice }: SearchDomainsBodySchema,
  ): Promise<PatternedDomainSearchResult> {
    return this.domains.searchDomainsForCampaign(campaign, patterns, maxPrice)
  }

  @Post('purchase')
  @UseCampaign({ include: { user: true } })
  @HttpCode(HttpStatus.ACCEPTED)
  @ResponseSchema(PurchaseDomainResponseSchema)
  @McpTool({
    description:
      'Purchase a specific available domain for the calling campaign. ' +
      'Call AFTER searchDomains has returned a candidate and the agent ' +
      'has chosen one. Pass the same maxPrice that searchDomains was ' +
      'called with; the server re-checks the live price against this ' +
      'cap and rejects with 409 if Vercel returned a higher price ' +
      'between search and purchase. Idempotent per campaign via a ' +
      'Postgres advisory transaction lock — safe to retry on transient ' +
      'errors; a repeated call for the same domain returns ' +
      'alreadyExisted: true. Conflicts (a different in-progress domain ' +
      'for the campaign, or the domain is no longer available) return ' +
      '4xx. On success the domain reaches DomainStatus.submitted. ' +
      'Poll GET /v1/domains/status to observe progression to ' +
      'registered / active.',
  })
  async purchaseDomain(
    @ReqCampaign() campaign: Campaign & { user: User },
    @Body() { domain, maxPrice }: PurchaseDomainBodySchema,
    @Req() req: IncomingRequest,
  ) {
    const source = req.agentToken ? DomainSource.agentic : DomainSource.manual
    const result = await this.domains.purchaseDomainForCampaign(
      campaign,
      domain,
      maxPrice,
      source,
    )
    return {
      domain: result.domain,
      alreadyExisted: result.alreadyExisted,
      message: result.message,
    }
  }

  @Get('status')
  @UseCampaign()
  async checkRegistrationStatus(
    @ReqCampaign() { id: campaignId }: Campaign,
  ): Promise<DomainStatusResponse> {
    const website = await this.websites.findUnique({
      where: { campaignId },
      select: { id: true },
    })

    if (!website) {
      throw new NotFoundException(NO_WEBSITE_FOUND_MESSAGE)
    }

    const domain = await this.domains.getDomainWithPayment(website.id)

    if (!domain) {
      return {
        message: DomainOperationStatus.NO_DOMAIN,
        paymentStatus: null,
      }
    }

    let paymentStatus: PaymentStatus | null = null
    if (domain.paymentId) {
      paymentStatus = await this.domains.getPaymentStatus(domain.paymentId)
    }

    let message: DomainOperationStatus
    switch (domain.status) {
      case DomainStatus.pending:
        message = DomainOperationStatus.IN_PROGRESS
        break
      case DomainStatus.submitted:
        message = DomainOperationStatus.SUBMITTED
        break
      case DomainStatus.registered:
        message = DomainOperationStatus.SUCCESSFUL
        break
      case DomainStatus.active:
        message = DomainOperationStatus.SUCCESSFUL
        break
      case DomainStatus.inactive:
        message = DomainOperationStatus.INACTIVE
        break
      default:
        message = DomainOperationStatus.ERROR
    }

    return {
      message,
      paymentStatus,
      operationDetail: {
        operationId: domain.operationId,
        status: message,
        type: DomainOperationType.REGISTER_DOMAIN,
        submittedDate: new Date(), // Could use domain creation date if needed
      },
    }
  }

  // After domain is successfully registered, disable auto renew and configure DNS
  // TODO: should be handled by a queued job instead of a controller https://goodparty.atlassian.net/browse/WEB-4233
  @Post('configure')
  @UseCampaign()
  @HttpCode(HttpStatus.OK)
  async configureDomain(@ReqCampaign() { id: campaignId }: Campaign) {
    // Resolve the caller's own website first. configureDomain looks up a Domain
    // by websiteId; passing campaignId straight through conflates two
    // independent autoincrement id spaces and lets the caller operate on
    // another tenant's domain (the one whose websiteId equals this campaignId).
    // Mirror deleteDomain, which resolves website.id from campaignId.
    const website = await this.websites.findUnique({
      where: { campaignId },
      select: { id: true },
    })

    if (!website) {
      throw new NotFoundException(NO_WEBSITE_FOUND_MESSAGE)
    }

    return this.domains.configureDomain(website.id)
  }

  @Delete()
  @UseCampaign()
  @HttpCode(HttpStatus.OK)
  async deleteDomain(@ReqCampaign() { id: campaignId }: Campaign) {
    const website = await this.websites.findUnique({
      where: { campaignId },
      select: {
        id: true,
        domain: { select: { status: true } },
      },
    })

    if (!website) {
      throw new NotFoundException(NO_WEBSITE_FOUND_MESSAGE)
    }

    if (!website.domain) {
      throw new NotFoundException('No domain found for this campaign')
    }

    // Only allow deletion if domain is pending or inactive
    if (
      website.domain.status !== DomainStatus.pending &&
      website.domain.status !== DomainStatus.inactive
    ) {
      throw new BadRequestException(
        `Cannot delete domain with status: ${website.domain.status}. Only pending or inactive domains can be deleted.`,
      )
    }

    return this.domains.deleteDomain(website.id)
  }
}
