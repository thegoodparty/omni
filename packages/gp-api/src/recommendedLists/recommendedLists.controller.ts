import {
  BadRequestException,
  Controller,
  Get,
  NotFoundException,
  Param,
  Query,
  Res,
  UseInterceptors,
} from '@nestjs/common'
import type { FastifyReply } from 'fastify'
import { ZodValidationPipe } from 'nestjs-zod'
import { RecommendedListsResponseSchema } from '@goodparty_org/contracts'
import { Organization } from '../generated/prisma'
import { CampaignsService } from '@/campaigns/services/campaigns.service'
import { ContactsService } from '@/contacts/services/contacts.service'
import { ReqOrganization } from '@/organizations/decorators/ReqOrganization.decorator'
import { UseOrganization } from '@/organizations/decorators/UseOrganization.decorator'
import { ResponseSchema } from '@/shared/decorators/ResponseSchema.decorator'
import { ZodResponseInterceptor } from '@/shared/interceptors/ZodResponse.interceptor'
import {
  DownloadRecommendedListParamsSchema,
  type DownloadRecommendedListParams,
} from './schemas/downloadRecommendedList.schema'
import {
  GetRecommendedListsQuerySchema,
  type GetRecommendedListsQuery,
} from './schemas/getRecommendedLists.schema'
import { RecommendedListsService } from './services/recommendedLists.service'

@Controller('campaigns/mine/recommended-lists')
@UseOrganization()
@UseInterceptors(ZodResponseInterceptor)
export class RecommendedListsController {
  constructor(
    private readonly recommendedLists: RecommendedListsService,
    private readonly campaigns: CampaignsService,
    private readonly contacts: ContactsService,
  ) {}

  @Get()
  @ResponseSchema(RecommendedListsResponseSchema)
  async get(
    @ReqOrganization() organization: Organization,
    @Query(new ZodValidationPipe(GetRecommendedListsQuerySchema))
    { channel, intent, variant }: GetRecommendedListsQuery,
  ) {
    // The primary gate, ahead of the service's own defence-in-depth 400:
    // an `eo-` (Serve) org has no Campaign row to resolve below, so this
    // has to run first rather than fall out of a failed lookup.
    if (organization.slug.startsWith('eo-')) {
      throw new BadRequestException(
        'Recommended lists are not available for this organization',
      )
    }

    const campaign = await this.campaigns.findFirstOrThrow({
      where: { organizationSlug: organization.slug },
    })

    return this.recommendedLists.recommend(
      organization,
      campaign,
      channel ?? null,
      intent ?? null,
      variant ?? null,
    )
  }

  // The voter data page's details sheet downloads a recommendation the
  // candidate has not saved. Headers are written inside the stream, after
  // the gates, so a refusal is still a structured 4xx and never a CSV named
  // file holding a JSON error body.
  @Get(':variant/download')
  async download(
    @ReqOrganization() organization: Organization,
    @Param(new ZodValidationPipe(DownloadRecommendedListParamsSchema))
    { variant }: DownloadRecommendedListParams,
    @Res() res: FastifyReply,
  ) {
    if (organization.slug.startsWith('eo-')) {
      throw new BadRequestException(
        'Recommended lists are not available for this organization',
      )
    }
    const campaign = await this.campaigns.findFirstOrThrow({
      where: { organizationSlug: organization.slug },
    })
    const filter = await this.recommendedLists.globalFilterFor(
      organization,
      campaign,
      variant,
    )
    if (!filter) {
      throw new NotFoundException(
        'This recommended list is not available for your campaign',
      )
    }
    await this.contacts.downloadFilter(filter, res, organization)
  }
}
