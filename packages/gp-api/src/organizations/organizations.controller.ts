import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Query,
  UseGuards,
  UseInterceptors,
  UsePipes,
} from '@nestjs/common'
import { ZodValidationPipe } from 'nestjs-zod'
import { z } from 'zod'
import {
  OrganizationStatus,
  OrganizationStatusSchema,
} from '@goodparty_org/contracts'
import {
  OrganizationsService,
  FriendlyOrganization,
} from './services/organizations.service'
import { ReqUser } from '@/authentication/decorators/ReqUser.decorator'
import { User } from '../generated/prisma'
import {
  AdminListOrganizationsDto,
  AdminPatchOrganizationDto,
  PatchOrganizationDto,
} from './schemas/organization.schema'
import { AdminOrM2MGuard } from '@/authentication/guards/AdminOrM2M.guard'
import { ResponseSchema } from '@/shared/decorators/ResponseSchema.decorator'
import { ZodResponseInterceptor } from '@/shared/interceptors/ZodResponse.interceptor'
import { organizationStatus } from '@/campaigns/util/eligibility.util'
import { pick } from 'es-toolkit'

// The decorated org-list shape returned by this controller is not the persisted
// Organization row, so it isn't OrganizationSchema from contracts; only the
// derived `status` enum is shared. Validated at runtime via @ResponseSchema.
// position/district sub-fields come straight from election-api, which is not
// runtime-validated here and legitimately returns null leaves (e.g. a position
// whose district has no L2 mapping yet). Before these endpoints were response-
// validated the null leaves shipped to the webapp untouched; the strict schema
// must tolerate the same shape or it 500s the whole org list — which makes the
// webapp see zero orgs and bounce the dashboard back into onboarding.
const APIOrganizationSchema = z.object({
  slug: z.string(),
  name: z.string().nullable(),
  positionName: z.string().nullable(),
  position: z
    .object({
      id: z.string(),
      state: z.string().nullable(),
      brPositionId: z.string().nullable(),
    })
    .nullable(),
  district: z
    .object({
      id: z.string(),
      state: z.string().nullable(),
      l2Type: z.string().nullable(),
      l2Name: z.string().nullable(),
    })
    .nullable(),
  electedOfficeId: z.string().nullable(),
  campaignId: z.number().nullable(),
  status: OrganizationStatusSchema,
})

type APIOrganization = z.infer<typeof APIOrganizationSchema>

const ListOrganizationsResponseSchema = z.object({
  organizations: z.array(APIOrganizationSchema),
})

// /admin/list returns each org plus an `extra` block. `campaign.details` is a
// free-form JSON blob, so it's typed `unknown` to pass through unvalidated
// rather than being stripped by the response interceptor.
const AdminListOrganizationSchema = APIOrganizationSchema.extend({
  extra: z.object({
    positionName: z.string().nullable(),
    hasDistrictOverride: z.boolean(),
    owner: z.object({
      id: z.number(),
      email: z.string(),
      firstName: z.string().nullable(),
      lastName: z.string().nullable(),
      phone: z.string().nullable(),
    }),
    campaign: z
      .object({ id: z.number(), slug: z.string(), details: z.unknown() })
      .nullable(),
  }),
})

const AdminListOrganizationsResponseSchema = z.object({
  organizations: z.array(AdminListOrganizationSchema),
})

const toAPIOrganization = (
  org: FriendlyOrganization,
  status: OrganizationStatus,
): APIOrganization => {
  const result: APIOrganization = {
    slug: org.slug,
    name: null,
    positionName: org.customPositionName ?? org.position?.name ?? null,
    position: null,
    district: null,
    electedOfficeId: null,
    campaignId: null,
    status,
  }

  result.position = org.position
    ? {
        id: org.position.id,
        state: org.position.state,
        brPositionId: org.position.brPositionId,
      }
    : null
  result.district = org.district
    ? {
        id: org.district.id,
        state: org.district.state,
        l2Type: org.district.l2Type,
        l2Name: org.district.l2Name,
      }
    : null

  if (org.slug.startsWith('eo-')) {
    result.electedOfficeId = org.slug.replace('eo-', '')
    result.name = result.positionName
  } else {
    result.campaignId = parseInt(org.slug.replace('campaign-', ''))
    const electionYear = org.campaign?.details.electionDate?.split('-').at(0)
    result.name = [electionYear, 'Campaign'].filter(Boolean).join(' ')
  }
  return result
}

@Controller('organizations')
@UsePipes(ZodValidationPipe)
@UseInterceptors(ZodResponseInterceptor)
export class OrganizationsController {
  constructor(private readonly organizationsService: OrganizationsService) {}

  @Get('/')
  @ResponseSchema(ListOrganizationsResponseSchema)
  async listOrganizations(
    @ReqUser() user: User,
  ): Promise<{ organizations: APIOrganization[] }> {
    const organizations = await this.organizationsService.listOrganizations(
      user.id,
    )

    const now = new Date()
    return {
      organizations: organizations.map((org) =>
        toAPIOrganization(org, organizationStatus(org, now)),
      ),
    }
  }

  @Get('/:slug')
  @ResponseSchema(APIOrganizationSchema)
  async getOrganization(
    @Param('slug') slug: string,
    @ReqUser() user: User,
  ): Promise<APIOrganization> {
    const org = await this.organizationsService.getOrganization(user.id, slug)
    return toAPIOrganization(org, organizationStatus(org, new Date()))
  }

  @Patch('/:slug')
  @ResponseSchema(APIOrganizationSchema)
  async patchOrganization(
    @Param('slug') slug: string,
    @ReqUser() user: User,
    @Body() updates: PatchOrganizationDto,
  ): Promise<APIOrganization> {
    const org = await this.organizationsService.patchOrganization(
      user.id,
      slug,
      updates,
    )

    return toAPIOrganization(org, organizationStatus(org, new Date()))
  }

  // NOTE: Static admin routes (e.g. `/admin/list`) MUST be declared before
  // parameterized admin routes (`/admin/:slug`). NestJS matches routes in
  // declaration order, so a parameterized route declared first will swallow
  // the static one (e.g. `GET /admin/list` would resolve to `adminGetOrganization`
  // with `slug = 'list'`).
  @Get('/admin/list')
  @UseGuards(AdminOrM2MGuard)
  @ResponseSchema(AdminListOrganizationsResponseSchema)
  async adminListOrganizations(@Query() query: AdminListOrganizationsDto) {
    const organizations =
      await this.organizationsService.adminListOrganizations(query)

    const now = new Date()
    return {
      organizations: organizations.map((org) => {
        const apiShape = toAPIOrganization(org, organizationStatus(org, now))
        return {
          ...apiShape,
          extra: {
            positionName: org.position?.name ?? null,
            hasDistrictOverride: org.hasDistrictOverride,
            owner: pick(org.owner, [
              'id',
              'email',
              'firstName',
              'lastName',
              'phone',
            ]),
            campaign: org.campaign
              ? pick(org.campaign, ['id', 'slug', 'details'])
              : null,
          },
        }
      }),
    }
  }

  @Get('/admin/:slug')
  @UseGuards(AdminOrM2MGuard)
  @ResponseSchema(APIOrganizationSchema)
  async adminGetOrganization(
    @Param('slug') slug: string,
  ): Promise<APIOrganization> {
    const org = await this.organizationsService.adminGetOrganization(slug)
    return toAPIOrganization(org, organizationStatus(org, new Date()))
  }

  @Patch('/admin/:slug')
  @UseGuards(AdminOrM2MGuard)
  @ResponseSchema(APIOrganizationSchema)
  async adminPatchOrganization(
    @Param('slug') slug: string,
    @Body() updates: AdminPatchOrganizationDto,
  ): Promise<APIOrganization> {
    const org = await this.organizationsService.adminPatchOrganization(
      slug,
      updates,
    )
    return toAPIOrganization(org, organizationStatus(org, new Date()))
  }
}
