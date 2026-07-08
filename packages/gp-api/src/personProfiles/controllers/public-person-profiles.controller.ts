import { PublicAccess } from '@/authentication/decorators/PublicAccess.decorator'
import { ResponseSchema } from '@/shared/decorators/ResponseSchema.decorator'
import { ZodResponseInterceptor } from '@/shared/interceptors/ZodResponse.interceptor'
import {
  Controller,
  Get,
  GoneException,
  NotFoundException,
  Query,
  UseInterceptors,
  UsePipes,
} from '@nestjs/common'
import { ZodValidationPipe } from 'nestjs-zod'
import { GetPublicPersonProfileDto } from '../schemas/public/GetPublicPersonProfile.schema'
import {
  PublicPersonProfileResponse,
  PublicPersonProfileResponseSchema,
  PublishedPersonProfileList,
  PublishedPersonProfileListSchema,
} from '../schemas/public/PublicPersonProfileResponse.schema'
import { PersonProfilesService } from '../services/person-profiles.service'
import {
  PublicProfileResult,
  recordPublicProfileRequest,
} from '../observability/person-profiles.metrics'

// The marketing site's render gate. A profile is only "live" when it is
// published and not deleted; this endpoint enforces that so unpublished/draft
// content never leaves the server:
//   - never existed / unpublished -> 404 (page renders "not found")
//   - deleted                     -> 410 Gone (page renders "removed")
//   - live                        -> 200 with the whitelisted overlay
@Controller('public-person-profiles')
@PublicAccess()
@UsePipes(ZodValidationPipe)
@UseInterceptors(ZodResponseInterceptor)
export class PublicPersonProfilesController {
  constructor(private readonly personProfilesService: PersonProfilesService) {}

  // Set of live profiles for the /people sitemap. Identity + freshness only;
  // the marketing site joins names from election-api to build canonical slugs.
  @Get('published')
  @ResponseSchema(PublishedPersonProfileListSchema)
  async listPublished(): Promise<PublishedPersonProfileList> {
    return this.personProfilesService.listPublished()
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
    return {
      ...profile,
      issues: profile.issues
        .filter((issue) => issue.visible)
        .map((issue) => ({
          issueId: issue.issueId,
          title: issue.priority?.title ?? null,
          description: issue.priority?.description ?? null,
          visible: issue.visible,
          transparency: issue.transparency,
          sortOrder: issue.sortOrder,
        })),
    }
  }
}
