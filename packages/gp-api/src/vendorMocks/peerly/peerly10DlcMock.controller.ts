import { PublicAccess } from '@/authentication/decorators/PublicAccess.decorator'
import { Prisma, VendorMockVendor } from '@/generated/prisma'
import { VENDOR_MODE } from '@/shared/util/appEnvironment.util'
import {
  PEERLY_ENTITY_TYPE,
  PEERLY_USECASE,
} from '@/vendors/peerly/services/peerly.const'
import {
  PEERLY_PROFILE_STATUS_FINALIZED,
  PEERLY_PROFILE_STATUS_PENDING,
  PEERLY_PROFILE_STATUS_WAITING_TO_FINALIZE,
} from '@/vendors/peerly/services/peerly.const'
import {
  peerlyGetIdentitiesResponseBodySchema,
  peerlyIdentityCreateResponseBodySchema,
  peerlyIdentityProfileResponseBodySchema,
  peerlyIdentitySchema,
} from '@/vendors/peerly/schemas/peerlyIdentity.schema'
import {
  approve10DLCBrandResponseBodySchema,
  peerly10DLCBrandSubmitResponseBodySchema,
} from '@/vendors/peerly/schemas/peerlyTdlc.schema'
import {
  Body,
  Controller,
  Get,
  Headers,
  HttpException,
  HttpStatus,
  NotFoundException,
  Param,
  Post,
  Query,
} from '@nestjs/common'
import { randomInt, randomUUID } from 'crypto'
import { format } from 'date-fns'
import { z } from 'zod'
import {
  PEERLY_10DLC_KIND,
  VendorMockRecordService,
} from '../vendorMockRecord.service'
import { assertValidMockJwt } from './peerlyMockAuth.util'

const MOCK_ACCOUNT_ID = 'mock-peerly'
const jsonRecordSchema = z.record(z.string(), z.json())

const profileStateSchema = z.object({
  status: z.string(),
  campaignVerifyToken: z.string().nullable().default(null),
  request: jsonRecordSchema.default({}),
})

const brandStateSchema = z.object({
  status: z.string(),
  submissionKey: z.string(),
  request: jsonRecordSchema.default({}),
})

type IdentityBody = Record<string, Prisma.JsonValue>

// Peerly's error envelope. `status_code` is the HTTP status, except when
// Peerly proxies Campaign Verify: then the HTTP status is 400 and CV's own
// status rides in `status_code` (see isPeerlyCvPinRejection).
const peerlyError = (
  status: HttpStatus,
  message: string,
  nestedStatus: number = status,
) => new HttpException({ Error: message, status_code: nestedStatus }, status)

const str = (source: Record<string, unknown>, key: string, fallback = '') => {
  const value = source[key]
  return typeof value === 'string' ? value : fallback
}

@Controller('vendor-mocks/peerly')
@PublicAccess()
export class Peerly10DlcMockController {
  constructor(private readonly vendorMockRecord: VendorMockRecordService) {}

  // IDENTITY AND PROFILE

  @Post('identities')
  async createIdentity(
    @Headers('authorization') authorization: string | undefined,
    @Body() body: IdentityBody,
  ) {
    this.enter(authorization)
    const identityName = str(body, 'identity_name', 'mock-identity')
    const identityId = await this.freshIdentityId()
    const state = peerlyIdentitySchema.parse({
      identity_id: identityId,
      identity_name: identityName,
      start_date: format(new Date(), 'yyyy-MM-dd'),
      account_id: str(body, 'account_id', MOCK_ACCOUNT_ID),
      tcr_identity_status: null,
      usecases: Array.isArray(body['usecases'])
        ? body['usecases'].filter((u) => typeof u === 'string')
        : [PEERLY_USECASE],
    })
    // WHY: the Peerly API has no campaign concept, and unlike the P2P mock
    // there is no per-campaign header to read. The identity name gp-api sends
    // ends in the campaign's EIN, so resolve the campaign through the
    // TcrCompliance row; later routes inherit it from this identity record.
    const campaignId = await this.vendorMockRecord.resolvePeerlyCampaignId({
      identityName,
    })
    await this.vendorMockRecord.upsert(
      VendorMockVendor.peerly,
      PEERLY_10DLC_KIND.identity,
      identityId,
      state,
      campaignId,
      body,
    )
    return peerlyIdentityCreateResponseBodySchema.parse({ Data: state })
  }

  @Get('identities/listByAccount')
  async listIdentitiesByAccount(
    @Headers('authorization') authorization: string | undefined,
    @Query('account_id') accountId?: string,
  ) {
    this.enter(authorization)
    const records = await this.vendorMockRecord.findMany({
      where: {
        vendor: VendorMockVendor.peerly,
        kind: PEERLY_10DLC_KIND.identity,
      },
      orderBy: { createdAt: 'asc' },
    })
    const identities = records
      .map((r) => peerlyIdentitySchema.parse(r.state))
      .filter((i) => !accountId || i.account_id === accountId)
    return peerlyGetIdentitiesResponseBodySchema.parse({ identities })
  }

  @Post('identities/:id/submitProfile')
  async submitProfile(
    @Headers('authorization') authorization: string | undefined,
    @Param('id') id: string,
    @Body() body: IdentityBody,
  ) {
    this.enter(authorization)
    const identity = await this.requireIdentity(id)
    const campaignId = await this.campaignIdFor(identity.campaignId, id)
    await this.vendorMockRecord.upsert(
      VendorMockVendor.peerly,
      PEERLY_10DLC_KIND.profile,
      id,
      {
        status: PEERLY_PROFILE_STATUS_PENDING,
        campaignVerifyToken: null,
        request: body,
      },
      campaignId,
      body,
    )
    return this.profileBody(id)
  }

  @Get('identities/:id/getProfile')
  async getProfile(
    @Headers('authorization') authorization: string | undefined,
    @Param('id') id: string,
  ) {
    this.enter(authorization)
    await this.requireIdentity(id)
    return this.profileBody(id)
  }

  // 10DLC BRAND

  @Post('v2/tdlc/:id/submit')
  async submitTdlc(
    @Headers('authorization') authorization: string | undefined,
    @Param('id') id: string,
    @Body() body: IdentityBody,
  ) {
    this.enter(authorization)
    const identity = await this.requireIdentity(id)
    const campaignId = await this.campaignIdFor(
      identity.campaignId,
      id,
      str(body, 'ein'),
    )
    const existing = await this.findBrand(id)
    const submissionKey = existing?.submissionKey ?? `mock-sub-${randomUUID()}`
    await this.vendorMockRecord.upsert(
      VendorMockVendor.peerly,
      PEERLY_10DLC_KIND.brand,
      id,
      {
        status: existing?.status ?? PEERLY_PROFILE_STATUS_PENDING,
        submissionKey,
        // Merged, so a later token-only submit (finalized brand re-open)
        // keeps the EIN and address from the first one.
        request: { ...existing?.request, ...body },
      } satisfies Prisma.InputJsonObject,
      campaignId,
      body,
    )
    // A submit re-opens a finalized brand to pending (the client relies on it
    // to attach a CV token after finalization).
    const profile = await this.findProfile(id)
    if (profile?.status === PEERLY_PROFILE_STATUS_FINALIZED) {
      await this.vendorMockRecord.patchState(
        VendorMockVendor.peerly,
        PEERLY_10DLC_KIND.profile,
        id,
        { status: PEERLY_PROFILE_STATUS_PENDING },
      )
    }
    return peerly10DLCBrandSubmitResponseBodySchema.parse({
      submission_key: submissionKey,
    })
  }

  @Post('v2/tdlc/:id/approve')
  async approveTdlc(
    @Headers('authorization') authorization: string | undefined,
    @Param('id') id: string,
    @Body() body: IdentityBody,
  ) {
    this.enter(authorization)
    const identity = await this.requireIdentity(id)
    // Mirrors Peerly: approving without a Campaign Verify token would
    // finalize the brand with no CV attached (the ENG-7508 failure mode).
    const token = str(body, 'campaign_verify_token')
    if (!token) {
      throw peerlyError(
        HttpStatus.BAD_REQUEST,
        'campaign_verify_token is required',
      )
    }
    const profile = await this.findProfile(id)
    if (!profile) throw peerlyError(HttpStatus.NOT_FOUND, 'Profile not found')
    const brand = await this.findBrand(id)
    const campaignId = await this.campaignIdFor(
      identity.campaignId,
      id,
      str(brand?.request ?? {}, 'ein'),
    )
    await this.vendorMockRecord.upsert(
      VendorMockVendor.peerly,
      PEERLY_10DLC_KIND.brand,
      id,
      {
        status: 'approved',
        submissionKey: brand?.submissionKey ?? `mock-sub-${randomUUID()}`,
        request: brand?.request ?? {},
      } satisfies Prisma.InputJsonObject,
      campaignId,
      body,
    )
    await this.vendorMockRecord.patchState(
      VendorMockVendor.peerly,
      PEERLY_10DLC_KIND.profile,
      id,
      { status: PEERLY_PROFILE_STATUS_WAITING_TO_FINALIZE },
    )
    // The use case starts PENDING when the brand is approved; the 5 minute
    // auto-activation clock is this record's createdAt.
    if (!(await this.findUsecase(id))) {
      await this.vendorMockRecord.upsert(
        VendorMockVendor.peerly,
        PEERLY_10DLC_KIND.usecase,
        id,
        { status: 'PENDING' },
        campaignId,
      )
    }

    const source = { ...brand?.request, ...profile.request }
    return approve10DLCBrandResponseBodySchema.parse({
      street: str(source, 'street'),
      usecases: identity.state.usecases ?? [PEERLY_USECASE],
      phone: str(source, 'phone'),
      legal_entity_type: str(source, 'entityType', PEERLY_ENTITY_TYPE),
      account_id: identity.state.account_id,
      companyName: str(source, 'companyName'),
      country: str(source, 'country', 'US'),
      postalCode: str(source, 'postalCode'),
      entityType: str(source, 'entityType', PEERLY_ENTITY_TYPE),
      base_account_id: identity.state.account_id,
      email: str(source, 'email'),
      state: str(source, 'state'),
      vertical: str(source, 'vertical', PEERLY_USECASE),
      is_political: true,
      website: str(source, 'website'),
      ein: str(source, 'ein'),
      sample1: str(body, 'sample1'),
      displayName: str(source, 'displayName'),
      status: PEERLY_PROFILE_STATUS_WAITING_TO_FINALIZE,
      entity_type: str(body, 'entity_type', PEERLY_ENTITY_TYPE),
      city: str(source, 'city'),
      usecase: str(body, 'usecase', PEERLY_USECASE),
      sample2: str(body, 'sample2'),
      campaign_verify_token: token,
    })
  }

  // Peerly returns a bare string here and the client never parses it.
  @Get('v2/tdlc/:id/finalize')
  async finalizeTdlc(
    @Headers('authorization') authorization: string | undefined,
    @Param('id') id: string,
  ) {
    this.enter(authorization)
    await this.requireIdentity(id)
    if (!(await this.findProfile(id))) {
      throw peerlyError(HttpStatus.NOT_FOUND, 'Profile not found')
    }
    await this.vendorMockRecord.patchState(
      VendorMockVendor.peerly,
      PEERLY_10DLC_KIND.profile,
      id,
      { status: PEERLY_PROFILE_STATUS_FINALIZED },
    )
    return 'Brand finalized'
  }

  @Post('v2/tdlc/:id/submit_cv')
  submitCvStub() {
    this.enter(undefined)
    throw new HttpException('Not implemented', HttpStatus.NOT_IMPLEMENTED)
  }

  @Get('v2/tdlc/:id/retrieve_cv')
  retrieveCvStub() {
    this.enter(undefined)
    throw new HttpException('Not implemented', HttpStatus.NOT_IMPLEMENTED)
  }

  @Post('v2/tdlc/:id/verify_pin')
  verifyPinStub() {
    this.enter(undefined)
    throw new HttpException('Not implemented', HttpStatus.NOT_IMPLEMENTED)
  }

  @Post('v2/tdlc/:id/resend_pin')
  resendPinStub() {
    this.enter(undefined)
    throw new HttpException('Not implemented', HttpStatus.NOT_IMPLEMENTED)
  }

  @Post('v2/tdlc/:id/create_cv_token')
  createCvTokenStub() {
    this.enter(undefined)
    throw new HttpException('Not implemented', HttpStatus.NOT_IMPLEMENTED)
  }

  @Get('v2/tdlc/:id/get_usecases')
  getUsecasesStub() {
    this.enter(undefined)
    throw new HttpException('Not implemented', HttpStatus.NOT_IMPLEMENTED)
  }

  // HELPERS

  // Mock mode first (404 in live), then the same JWT the P2P mock hands out
  // from token-auth.
  private enter(authorization: string | undefined) {
    if (VENDOR_MODE !== 'mock') throw new NotFoundException()
    assertValidMockJwt(authorization)
  }

  private async freshIdentityId(): Promise<string> {
    const candidate = String(randomInt(10_000_000, 100_000_000))
    const taken = await this.vendorMockRecord.findOne(
      VendorMockVendor.peerly,
      PEERLY_10DLC_KIND.identity,
      candidate,
    )
    return taken ? this.freshIdentityId() : candidate
  }

  private async requireIdentity(id: string) {
    const record = await this.vendorMockRecord.findOne(
      VendorMockVendor.peerly,
      PEERLY_10DLC_KIND.identity,
      id,
    )
    if (!record) throw peerlyError(HttpStatus.NOT_FOUND, 'Identity not found')
    return {
      campaignId: record.campaignId ?? undefined,
      state: peerlyIdentitySchema.parse(record.state),
    }
  }

  // A record written before its TcrCompliance row existed (or resolved to a
  // different campaign) picks the link up on a later call.
  private async campaignIdFor(
    known: number | undefined,
    identityId: string,
    ein?: string,
  ) {
    return (
      known ??
      (await this.vendorMockRecord.resolvePeerlyCampaignId({ identityId, ein }))
    )
  }

  private async findProfile(id: string) {
    const record = await this.vendorMockRecord.findOne(
      VendorMockVendor.peerly,
      PEERLY_10DLC_KIND.profile,
      id,
    )
    return record ? profileStateSchema.parse(record.state) : undefined
  }

  private async findBrand(id: string) {
    const record = await this.vendorMockRecord.findOne(
      VendorMockVendor.peerly,
      PEERLY_10DLC_KIND.brand,
      id,
    )
    return record ? brandStateSchema.parse(record.state) : undefined
  }

  private async findUsecase(id: string) {
    return this.vendorMockRecord.findOne(
      VendorMockVendor.peerly,
      PEERLY_10DLC_KIND.usecase,
      id,
    )
  }

  private async profileBody(id: string) {
    const identity = await this.requireIdentity(id)
    const profile = await this.findProfile(id)
    if (!profile) throw peerlyError(HttpStatus.NOT_FOUND, 'Profile not found')
    const brand = await this.findBrand(id)
    const source = { ...profile.request, ...brand?.request }
    const { account_id: accountId } = identity.state
    return peerlyIdentityProfileResponseBodySchema.parse({
      link: `https://peerly.mock.invalid/profile/${id}`,
      profile: {
        account_id: accountId,
        base_account_id: accountId,
        campaignVerifyToken: profile.campaignVerifyToken,
        campaigns: {},
        city: str(source, 'city'),
        companyName: str(source, 'companyName'),
        country: str(source, 'country', 'US'),
        displayName: str(source, 'displayName'),
        ein: str(source, 'ein'),
        email: str(source, 'email'),
        entityType: str(source, 'entityType', PEERLY_ENTITY_TYPE),
        is_political: true,
        legal_entity_type: str(source, 'entityType', PEERLY_ENTITY_TYPE),
        phone: str(source, 'phone'),
        postalCode: str(source, 'postalCode'),
        state: str(source, 'state'),
        status: profile.status,
        street: str(source, 'street'),
        usecase: PEERLY_USECASE,
        vertical: PEERLY_USECASE,
        usecases: identity.state.usecases ?? [PEERLY_USECASE],
        website: str(source, 'website'),
        will_send_over_2k: false,
      },
    })
  }
}
