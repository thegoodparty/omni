import { PublicAccess } from '@/authentication/decorators/PublicAccess.decorator'
import { ResponseSchema } from '@/shared/decorators/ResponseSchema.decorator'
import { ZodResponseInterceptor } from '@/shared/interceptors/ZodResponse.interceptor'
import {
  Body,
  Controller,
  Get,
  GoneException,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Post,
  Query,
  UseGuards,
  UseInterceptors,
  UsePipes,
} from '@nestjs/common'
import { ZodValidationPipe } from 'nestjs-zod'
import { ProfileClaimRequestRateLimitGuard } from '../guards/profileClaimRequestRateLimit.guard'
import { GetPublicPersonProfileDto } from '../schemas/public/GetPublicPersonProfile.schema'
import {
  PublicPersonProfileResponse,
  PublicPersonProfileResponseSchema,
  PublishedPersonProfileList,
  PublishedPersonProfileListSchema,
  RemovedPersonProfileList,
  RemovedPersonProfileListSchema,
} from '../schemas/public/PublicPersonProfileResponse.schema'
import {
  CreateProfileClaimRequestDto,
  ProfileClaimRequestResponse,
  ProfileClaimRequestResponseSchema,
} from '../schemas/public/ProfileClaimRequest.schema'
import { PersonProfilesService } from '../services/person-profiles.service'
import { VoterDensityProxyService } from '../services/voter-density-proxy.service'
import {
  GetVoterDensityDto,
  VoterDensityResponse,
  VoterDensityResponseSchema,
} from '../schemas/public/VoterDensity.schema'
import {
  PublicProfileResult,
  recordPublicProfileRequest,
  recordVoterDensityRequest,
} from '../observability/person-profiles.metrics'

// A 200 "removal requested" payload: identity-free, no authored content, just
// the `removed` flag so the marketing site knows to render the minimal K/L
// states (which still show the crawlable civics spine from election-api). All
// overlay fields are null; issues is empty.
function buildRemovedResponse(personId: string): PublicPersonProfileResponse {
  return {
    personId,
    removed: true,
    displayName: null,
    roleTitleOverride: null,
    bioOverride: null,
    coverImageUrl: null,
    avatarUrl: null,
    whyRunning: null,
    accomplishments: null,
    recentExperience: null,
    publicEmail: null,
    publicPhone: null,
    officePhone: null,
    websiteUrl: null,
    governmentWebsiteUrl: null,
    instagramUrl: null,
    tiktokUrl: null,
    facebookUrl: null,
    twitterUrl: null,
    linkedinUrl: null,
    defaultTransparency: null,
    publishedAt: null,
    updatedAt: new Date(),
    issues: [],
  }
}

// The marketing site's render gate. A profile is only "live" when it is
// published and not deleted; this endpoint enforces that so unpublished/draft
// content never leaves the server:
//   - removal requested           -> 200 { removed: true } (page renders K/L)
//   - never existed / unpublished -> 404 (page renders "not found")
//   - deleted                     -> 410 Gone (page renders "removed")
//   - live                        -> 200 with the whitelisted overlay
@Controller('public-person-profiles')
@PublicAccess()
@UsePipes(ZodValidationPipe)
@UseInterceptors(ZodResponseInterceptor)
export class PublicPersonProfilesController {
  constructor(
    private readonly personProfilesService: PersonProfilesService,
    private readonly voterDensityProxy: VoterDensityProxyService,
  ) {}

  // Voter-density heat-map cells for the person's office/district. Public +
  // progressive enhancement: resolve the person's L2 district (election-api),
  // then proxy the precomputed, k-anonymized cells (people-api, S2S). 404 when
  // the person maps to no district so the page renders no map.
  @Get('voter-density')
  @ResponseSchema(VoterDensityResponseSchema)
  async getVoterDensity(
    @Query() dto: GetVoterDensityDto,
  ): Promise<VoterDensityResponse> {
    const startedAt = Date.now()
    const elapsed = (): number => Date.now() - startedAt

    let result: VoterDensityResponse | null
    try {
      result = await this.voterDensityProxy.getVoterDensity(dto.personId)
    } catch (error) {
      recordVoterDensityRequest('error', elapsed())
      throw error
    }

    if (!result) {
      recordVoterDensityRequest('no_district', elapsed())
      throw new NotFoundException('No voter density available for this person')
    }

    recordVoterDensityRequest(
      result.cells.length > 0 ? 'live' : 'empty',
      elapsed(),
    )
    return result
  }

  // Set of live profiles for the /people sitemap. Identity + freshness only;
  // the marketing site joins names from election-api to build canonical slugs.
  @Get('published')
  @ResponseSchema(PublishedPersonProfileListSchema)
  async listPublished(): Promise<PublishedPersonProfileList> {
    return this.personProfilesService.listPublished()
  }

  // Exclusion set for the /people sitemap, which emits a URL per person page:
  // a person with a removal on record renders the noindex K/L states, so the
  // sitemap must subtract this list rather than advertise them.
  @Get('removed')
  @ResponseSchema(RemovedPersonProfileListSchema)
  async listRemoved(): Promise<RemovedPersonProfileList> {
    return this.personProfilesService.listRemoved()
  }

  @Get()
  @ResponseSchema(PublicPersonProfileResponseSchema)
  async getByPersonId(
    @Query() dto: GetPublicPersonProfileDto,
  ): Promise<PublicPersonProfileResponse> {
    const startedAt = Date.now()
    // Record the render-gate outcome exactly once, on every exit path, so the
    // metric captures 404/410 gate hits as well as live serves.
    const gate = (result: PublicProfileResult): void =>
      recordPublicProfileRequest(result, Date.now() - startedAt)

    // Privacy takedown wins over everything else (including a claimed, published
    // overlay): if the person has requested removal, serve the minimal "removed"
    // marker and no authored content. The marketing site renders K/L from this.
    if (await this.personProfilesService.isRemoved(dto.personId)) {
      gate('removed')
      return buildRemovedResponse(dto.personId)
    }

    const profile = await this.personProfilesService.findByPersonId(
      dto.personId,
    )

    if (!profile) {
      gate('not_found')
      throw new NotFoundException('Profile not found')
    }
    if (profile.deletedAt) {
      gate('gone')
      throw new GoneException('Profile has been removed')
    }
    if (!profile.publishedAt) {
      gate('not_found')
      throw new NotFoundException('Profile is not published')
    }

    gate('live')
    // NOTE ON STATUS PILLS: the per-issue `status` below drives the progress
    // pills on the profile's priorities section (IN PROGRESS / PRIORITIZED /
    // ONGOING / RESOLVED). Accomplishments (`profile.accomplishments`, spread
    // via `...profile`) are a separate JSON list and render a CONSTANT
    // "RESOLVED" tag in the design — that tag is a fixed UI label, not stored
    // per accomplishment, so there is intentionally no status column on the
    // accomplishments JSON. See personProfile.jsonTypes.d.ts.
    return {
      ...profile,
      issues: profile.issues
        .filter((issue) => issue.visible)
        .map((issue) => ({
          issueId: issue.issueId,
          title: issue.priority?.title ?? null,
          description: issue.priority?.description ?? null,
          visible: issue.visible,
          status: issue.status,
          transparency: issue.transparency,
          sortOrder: issue.sortOrder,
        })),
    }
  }

  // Inbound lead capture from the unclaimed-profile modal. Public + unauth by
  // design: a visitor volunteers an email (and optional name) so we can nudge
  // the person to claim their profile. We just store it — no dedupe, no PII
  // gymnastics beyond validation. Because it's an unauthenticated write, a
  // per-IP rate-limit guard (mirroring the briefings-share stopgap) keeps a
  // scripted caller from flooding the leads table until edge/WAF limits land.
  @Post('claim-request')
  @HttpCode(HttpStatus.CREATED)
  @ResponseSchema(ProfileClaimRequestResponseSchema)
  @UseGuards(ProfileClaimRequestRateLimitGuard)
  async createClaimRequest(
    @Body() dto: CreateProfileClaimRequestDto,
  ): Promise<ProfileClaimRequestResponse> {
    return this.personProfilesService.createClaimRequest(dto)
  }
}
