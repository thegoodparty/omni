import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Query,
  Req,
  UseGuards,
  UseInterceptors,
  UsePipes,
} from '@nestjs/common'
import { PinoLogger } from 'nestjs-pino'
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
import { IncomingRequest } from '@/authentication/authentication.types'
import { effectiveUser } from '@/authentication/util/effectiveUser.util'
import { ResponseSchema } from '@/shared/decorators/ResponseSchema.decorator'
import { ZodResponseInterceptor } from '@/shared/interceptors/ZodResponse.interceptor'
import { organizationStatus } from '@/campaigns/util/eligibility.util'
import { pick } from 'es-toolkit'

// The decorated org-list shape returned by this controller is not the persisted
// Organization row, so it isn't OrganizationSchema from contracts; only the
// derived `status` enum is shared. Validated at runtime via @ResponseSchema.
//
// Everything except `slug` and the derived `status` is a best-effort display
// enrichment sourced from election-api, which is NOT runtime-validated here and
// legitimately returns null/absent leaves (a position with no L2 district, a
// missing brPositionId, etc.). Before these endpoints were response-validated
// those values shipped to the webapp untouched and nothing broke; the schema
// must tolerate the same shape or one bad leaf 500s the WHOLE org list — which
// makes the webapp (getCurrentUserOrganizations maps any non-ok to []) see zero
// orgs and bounce the dashboard back into onboarding. So the display leaves are
// nullable and only slug/status are guaranteed.
// Everything is `.nullish()` (null OR absent) except slug + the derived status:
// election-api omits these leaves entirely for some positions/districts (the
// key is undefined, not null), and z.string().nullable() rejects undefined with
// "Required" — which 500s the whole list. nullish accepts string | null |
// undefined, matching the untyped shape that shipped before this endpoint was
// response-validated.
const APIOrganizationSchema = z.object({
  slug: z.string(),
  name: z.string().nullish(),
  positionName: z.string().nullish(),
  customPositionName: z.string().nullish(),
  position: z
    .object({
      id: z.string().nullish(),
      name: z.string().nullish(),
      state: z.string().nullish(),
      brPositionId: z.string().nullish(),
    })
    .nullish(),
  district: z
    .object({
      id: z.string().nullish(),
      state: z.string().nullish(),
      l2Type: z.string().nullish(),
      l2Name: z.string().nullish(),
    })
    .nullish(),
  electedOfficeId: z.string().nullish(),
  campaignId: z.number().nullish(),
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

// The single-org admin read, extended the same way the list shape above is:
// the door-knocking waypoint override is readable exactly where it is
// writable, and nowhere else. It stays off APIOrganizationSchema because that
// shape is what a candidate gets back about their own organization, and a
// control over vendor spend is not part of the answer to "what is my org?".
//
// Not a confidentiality boundary — the 429 quotes an org's own limit straight
// back to the candidate who hits it — but a question of which contract owns
// the field. Absent it, the value could be set and never read, which leaves
// an admin unable to tell whether an org already has one.
const AdminOrganizationDetailSchema = APIOrganizationSchema.extend({
  overrideDoorKnockingWaypointLimit: z.number().int().nullable(),
})

type AdminOrganizationDetail = z.infer<typeof AdminOrganizationDetailSchema>

const toAPIOrganization = (
  org: FriendlyOrganization,
  status: OrganizationStatus,
): APIOrganization => {
  const result: APIOrganization = {
    slug: org.slug,
    name: null,
    positionName: org.customPositionName ?? org.position?.name ?? null,
    customPositionName: org.customPositionName ?? null,
    position: null,
    district: null,
    electedOfficeId: null,
    campaignId: null,
    status,
  }

  result.position = org.position
    ? {
        id: org.position.id,
        name: org.position.name,
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
    // A non-`campaign-<int>` slug would parse to NaN; z.number() rejects NaN
    // and would 500 the whole list, so fall back to null.
    const parsedCampaignId = parseInt(org.slug.replace('campaign-', ''))
    result.campaignId = Number.isNaN(parsedCampaignId) ? null : parsedCampaignId
    const electionYear = org.campaign?.details?.electionDate?.split('-').at(0)
    result.name = [electionYear, 'Campaign'].filter(Boolean).join(' ')
  }
  return result
}

@Controller('organizations')
@UsePipes(ZodValidationPipe)
@UseInterceptors(ZodResponseInterceptor)
export class OrganizationsController {
  constructor(
    private readonly organizationsService: OrganizationsService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(OrganizationsController.name)
  }

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
  @ResponseSchema(AdminOrganizationDetailSchema)
  async adminGetOrganization(
    @Param('slug') slug: string,
  ): Promise<AdminOrganizationDetail> {
    const org = await this.organizationsService.adminGetOrganization(slug)
    return {
      ...toAPIOrganization(org, organizationStatus(org, new Date())),
      overrideDoorKnockingWaypointLimit: org.overrideDoorKnockingWaypointLimit,
    }
  }

  @Patch('/admin/:slug')
  @UseGuards(AdminOrM2MGuard)
  @ResponseSchema(AdminOrganizationDetailSchema)
  async adminPatchOrganization(
    @Param('slug') slug: string,
    @Req() req: IncomingRequest,
    @Body() updates: AdminPatchOrganizationDto,
  ): Promise<AdminOrganizationDetail> {
    // The previous limit comes back from the patch itself rather than from a
    // read taken here: it is then the value that this write replaced, and not
    // one a concurrent admin PATCH could have already overwritten in between.
    const { organization: org, previousLimit } =
      await this.organizationsService.adminPatchOrganization(slug, updates)

    // Only when the patch names the field — an org edit that leaves the
    // spending limit alone should not emit a spend-control line into the log.
    const touchesWaypointLimit = 'overrideDoorKnockingWaypointLimit' in updates
    const newLimit = updates.overrideDoorKnockingWaypointLimit ?? null
    if (touchesWaypointLimit && newLimit !== previousLimit) {
      // There is no audit table anywhere in gp-api, and AdminAuditInterceptor
      // keys off @Roles(admin) metadata, which this AdminOrM2MGuard route does
      // not carry — so this line is the only durable record that someone moved
      // an organization's Geoapify spending limit. `event:` is queryable in
      // Loki exactly as `DoorKnockingSpend` is.
      //
      // The actor is often unknowable here and that is a real limitation, not
      // an oversight: gp-admin calls this with an M2M token and authorizes the
      // human in its own server action, so `req.user` is empty and the email
      // below is null for the calls this endpoint mostly serves.
      this.logger.info(
        {
          event: 'DoorKnockingWaypointLimitOverride',
          organizationSlug: slug,
          previousLimit,
          newLimit,
          actorEmail: effectiveUser(req)?.email ?? null,
        },
        'Door knocking waypoint limit override changed',
      )
    }

    return {
      ...toAPIOrganization(org, organizationStatus(org, new Date())),
      overrideDoorKnockingWaypointLimit: org.overrideDoorKnockingWaypointLimit,
    }
  }
}
