import { PublicAccess } from '@/authentication/decorators/PublicAccess.decorator'
import { VENDOR_MODE } from '@/shared/util/appEnvironment.util'
import { VendorMockVendor, Prisma } from '@/generated/prisma'
import {
  peerlyIdentityCreateResponseBodySchema,
  peerlyGetIdentitiesResponseBodySchema,
  peerlyIdentityProfileResponseBodySchema,
} from '@/vendors/peerly/schemas/peerlyIdentity.schema'
import {
  peerly10DLCBrandSubmitResponseBodySchema,
  approve10DLCBrandResponseBodySchema,
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
} from '@nestjs/common'
import { format } from 'date-fns'
import { randomUUID } from 'crypto'
import { VendorMockRecordService } from '../vendorMockRecord.service'
import { verifyPeerlyMockJwt } from './peerlyMockJwt'

const MOCK_ACCOUNT = 'mock-peerly'

// Safely coerce a Prisma JSON value (which may be undefined due to index
// access on JsonObject) to string, boolean, or string[]. Accepts null and
// undefined from both JsonObject and InputJsonObject index reads.
const jsonObj = (v: Prisma.JsonValue): Prisma.JsonObject =>
  typeof v === 'object' && v !== null && !Array.isArray(v) ? v : {}

const str = (v: Prisma.JsonValue | null | undefined): string =>
  typeof v === 'string' ? v : ''

const bool = (v: Prisma.JsonValue | null | undefined): boolean =>
  typeof v === 'boolean' ? v : false

const strArr = (v: Prisma.JsonValue | null | undefined): string[] =>
  Array.isArray(v)
    ? (v as Prisma.JsonValue[]).filter(
        (x): x is string => typeof x === 'string',
      )
    : []

@Controller('vendor-mocks/peerly')
@PublicAccess()
export class Peerly10DlcMockController {
  constructor(private readonly vendorMockRecord: VendorMockRecordService) {}

  @Post('identities')
  async createIdentity(
    @Body() body: Record<string, Prisma.JsonValue>,
    @Headers('authorization') auth: string,
  ) {
    verifyPeerlyMockJwt(auth)
    this.assertMockMode()
    const identityName = str(body['identity_name'] ?? null)
    const usecasesRaw = body['usecases'] ?? null
    const usecases = Array.isArray(usecasesRaw)
      ? strArr(usecasesRaw)
      : ['POLITICAL']
    const identityId = String(
      Math.floor(Math.random() * 90_000_000) + 10_000_000,
    )
    const today = format(new Date(), 'yyyy-MM-dd')
    const state: Prisma.InputJsonObject = {
      identity_id: identityId,
      identity_name: identityName,
      start_date: today,
      account_id: MOCK_ACCOUNT,
      tcr_identity_status: null,
      usecases,
    }
    // WHY: Peerly identity creation carries no campaign identifier beyond
    // identity_name. We parse the EIN suffix and look up TcrCompliance to
    // link mock records to their campaign for the test-fixtures endpoint.
    const campaignId =
      await this.vendorMockRecord.campaignIdFromIdentityName(identityName)
    await this.vendorMockRecord.upsert(
      VendorMockVendor.peerly,
      'identity',
      identityId,
      state,
      campaignId,
      body,
    )
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
    const stateForParse = state as Prisma.JsonObject
    return peerlyIdentityCreateResponseBodySchema.parse({
      Data: stateForParse,
    })
  }

  @Get('identities/listByAccount')
  async listIdentitiesByAccount(@Headers('authorization') auth: string) {
    verifyPeerlyMockJwt(auth)
    this.assertMockMode()
    const records = await this.vendorMockRecord.findMany({
      where: { vendor: VendorMockVendor.peerly, kind: 'identity' },
    })
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
    const identities = records.map((r) => jsonObj(r.state as Prisma.JsonValue))
    return peerlyGetIdentitiesResponseBodySchema.parse({ identities })
  }

  @Post('identities/:id/submitProfile')
  async submitProfile(
    @Param('id') id: string,
    @Body() body: Record<string, Prisma.JsonValue>,
    @Headers('authorization') auth: string,
  ) {
    verifyPeerlyMockJwt(auth)
    this.assertMockMode()
    const identityRecord = await this.findIdentityRecord(id)
    const profileState: Prisma.InputJsonObject = {
      status: 'pending',
      entityType: str(body['entityType'] ?? null) || 'NON_PROFIT',
      is_political:
        typeof body['is_political'] === 'boolean' ? body['is_political'] : true,
      campaign_verify_token: null,
    }
    await this.vendorMockRecord.upsert(
      VendorMockVendor.peerly,
      'profile',
      id,
      profileState,
      identityRecord.campaignId ?? undefined,
      body,
    )
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
    const profileStateForRead = profileState as Prisma.JsonObject
    return peerlyIdentityProfileResponseBodySchema.parse({
      link: `https://mock.peerly.com/identities/${id}/profile`,
      profile: this.buildProfileShape(id, profileStateForRead, null),
    })
  }

  @Get('identities/:id/getProfile')
  async getProfile(
    @Param('id') id: string,
    @Headers('authorization') auth: string,
  ) {
    verifyPeerlyMockJwt(auth)
    this.assertMockMode()
    await this.findIdentityRecord(id)
    const profileRecords = await this.vendorMockRecord.findMany({
      where: {
        vendor: VendorMockVendor.peerly,
        kind: 'profile',
        externalId: id,
      },
    })
    if (!profileRecords[0]) throw new NotFoundException()
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
    const profileState = jsonObj(profileRecords[0].state as Prisma.JsonValue)
    const brandRecords = await this.vendorMockRecord.findMany({
      where: {
        vendor: VendorMockVendor.peerly,
        kind: 'brand',
        externalId: id,
      },
    })
    const brandState = brandRecords[0]
      ? // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
        jsonObj(brandRecords[0].state as Prisma.JsonValue)
      : null
    return peerlyIdentityProfileResponseBodySchema.parse({
      link: `https://mock.peerly.com/identities/${id}/profile`,
      profile: this.buildProfileShape(id, profileState, brandState),
    })
  }

  @Post('v2/tdlc/:id/submit')
  async submitTdlc(
    @Param('id') id: string,
    @Body() body: Record<string, Prisma.JsonValue>,
    @Headers('authorization') auth: string,
  ) {
    verifyPeerlyMockJwt(auth)
    this.assertMockMode()
    const identityRecord = await this.findIdentityRecord(id)
    const existing = await this.vendorMockRecord.findMany({
      where: {
        vendor: VendorMockVendor.peerly,
        kind: 'brand',
        externalId: id,
      },
    })
    const existingState = existing[0]
      ? // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
        jsonObj(existing[0].state as Prisma.JsonValue)
      : {}
    const submissionKey = str(existingState['submission_key']) || randomUUID()
    const brandState: Prisma.InputJsonObject = {
      ...existingState,
      ...body,
      submission_key: submissionKey,
      status: 'pending',
    }
    await this.vendorMockRecord.upsert(
      VendorMockVendor.peerly,
      'brand',
      id,
      brandState,
      identityRecord.campaignId ?? undefined,
      body,
    )
    return peerly10DLCBrandSubmitResponseBodySchema.parse({
      submission_key: submissionKey,
    })
  }

  @Post('v2/tdlc/:id/approve')
  async approveTdlc(
    @Param('id') id: string,
    @Body() body: Record<string, Prisma.JsonValue>,
    @Headers('authorization') auth: string,
  ) {
    verifyPeerlyMockJwt(auth)
    this.assertMockMode()
    const cvToken = str(body['campaign_verify_token'] ?? null)
    if (!cvToken) {
      throw new HttpException(
        {
          Error: 'campaign_verify_token is required.',
          status_code: HttpStatus.BAD_REQUEST,
        },
        HttpStatus.BAD_REQUEST,
      )
    }
    await this.findIdentityRecord(id)
    const brandRecords = await this.vendorMockRecord.findMany({
      where: {
        vendor: VendorMockVendor.peerly,
        kind: 'brand',
        externalId: id,
      },
    })
    if (!brandRecords[0]) throw new NotFoundException()
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
    const brandState = jsonObj(brandRecords[0].state as Prisma.JsonValue)
    const sample1 = str(body['sample1'] ?? null)
    const sample2 = str(body['sample2'] ?? null)
    await this.vendorMockRecord.upsert(
      VendorMockVendor.peerly,
      'brand',
      id,
      {
        ...brandState,
        status: 'approved',
        campaign_verify_token: cvToken,
        sample1,
        sample2,
      },
      brandRecords[0].campaignId ?? undefined,
      body,
    )
    const profileRecords = await this.vendorMockRecord.findMany({
      where: {
        vendor: VendorMockVendor.peerly,
        kind: 'profile',
        externalId: id,
      },
    })
    if (profileRecords[0]) {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      const profileState = jsonObj(profileRecords[0].state as Prisma.JsonValue)
      await this.vendorMockRecord.upsert(
        VendorMockVendor.peerly,
        'profile',
        id,
        { ...profileState, status: 'waiting_to_finalize' },
        profileRecords[0].campaignId ?? undefined,
      )
    }
    return approve10DLCBrandResponseBodySchema.parse({
      street: str(brandState['street']),
      usecases: strArr(brandState['usecases']),
      phone: str(brandState['phone']),
      legal_entity_type: str(brandState['entityType']) || 'NON_PROFIT',
      account_id: MOCK_ACCOUNT,
      companyName: str(brandState['companyName']),
      country: str(brandState['country']) || 'US',
      postalCode: str(brandState['postalCode']),
      entityType: str(brandState['entityType']) || 'NON_PROFIT',
      base_account_id: MOCK_ACCOUNT,
      email: str(brandState['email']),
      state: str(brandState['state']),
      vertical: str(brandState['vertical']) || 'POLITICAL',
      is_political: bool(brandState['is_political']),
      website: str(brandState['website']),
      ein: str(brandState['ein']),
      sample1,
      displayName: str(brandState['displayName']),
      status: 'approved',
      entity_type: str(brandState['entityType']) || 'NON_PROFIT',
      city: str(brandState['city']),
      usecase: 'POLITICAL',
      sample2,
      campaign_verify_token: cvToken,
    })
  }

  @Get('v2/tdlc/:id/finalize')
  async finalizeTdlc(
    @Param('id') id: string,
    @Headers('authorization') auth: string,
  ) {
    verifyPeerlyMockJwt(auth)
    this.assertMockMode()
    await this.findIdentityRecord(id)
    const profileRecords = await this.vendorMockRecord.findMany({
      where: {
        vendor: VendorMockVendor.peerly,
        kind: 'profile',
        externalId: id,
      },
    })
    if (profileRecords[0]) {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      const profileState = jsonObj(profileRecords[0].state as Prisma.JsonValue)
      await this.vendorMockRecord.upsert(
        VendorMockVendor.peerly,
        'profile',
        id,
        { ...profileState, status: 'finalized' },
        profileRecords[0].campaignId ?? undefined,
      )
    }
    return ''
  }

  @Post('v2/tdlc/:id/submit_cv')
  submitCv(@Headers('authorization') auth: string) {
    verifyPeerlyMockJwt(auth)
    this.assertMockMode()
    this.notImplemented()
  }

  @Get('v2/tdlc/:id/retrieve_cv')
  retrieveCv(@Headers('authorization') auth: string) {
    verifyPeerlyMockJwt(auth)
    this.assertMockMode()
    this.notImplemented()
  }

  @Post('v2/tdlc/:id/verify_pin')
  verifyPin(@Headers('authorization') auth: string) {
    verifyPeerlyMockJwt(auth)
    this.assertMockMode()
    this.notImplemented()
  }

  @Post('v2/tdlc/:id/resend_pin')
  resendPin(@Headers('authorization') auth: string) {
    verifyPeerlyMockJwt(auth)
    this.assertMockMode()
    this.notImplemented()
  }

  @Post('v2/tdlc/:id/create_cv_token')
  createCvToken(@Headers('authorization') auth: string) {
    verifyPeerlyMockJwt(auth)
    this.assertMockMode()
    this.notImplemented()
  }

  @Get('v2/tdlc/:id/get_usecases')
  getUsecases(@Headers('authorization') auth: string) {
    verifyPeerlyMockJwt(auth)
    this.assertMockMode()
    this.notImplemented()
  }

  private assertMockMode() {
    if (VENDOR_MODE !== 'mock') throw new NotFoundException()
  }

  private notImplemented(): never {
    throw new HttpException('Not implemented', HttpStatus.NOT_IMPLEMENTED)
  }

  private async findIdentityRecord(id: string) {
    const records = await this.vendorMockRecord.findMany({
      where: {
        vendor: VendorMockVendor.peerly,
        kind: 'identity',
        externalId: id,
      },
    })
    const record = records[0]
    if (!record) throw new NotFoundException()
    return record
  }

  // Build the peerlyIdentityProfileSchema-compatible shape from profile state
  // and (once available) brand state. `vertical` is only included after the
  // brand is submitted — it signals to the real service that a brand exists.
  private buildProfileShape(
    identityId: string,
    profileState: Prisma.JsonObject,
    brandState: Prisma.JsonObject | null,
  ) {
    const status = str(profileState['status']) || 'pending'
    const cvTokenRaw = profileState['campaign_verify_token']
    const campaignVerifyToken =
      typeof cvTokenRaw === 'string' ? cvTokenRaw : null
    return {
      account_id: MOCK_ACCOUNT,
      base_account_id: MOCK_ACCOUNT,
      campaignVerifyToken,
      campaigns: {},
      city: brandState ? str(brandState['city']) : '',
      companyName: brandState ? str(brandState['companyName']) : '',
      country: null,
      displayName: brandState ? str(brandState['displayName']) : '',
      ein: brandState ? str(brandState['ein']) : '',
      email: brandState ? str(brandState['email']) : '',
      entityType: brandState
        ? str(brandState['entityType']) || 'NON_PROFIT'
        : str(profileState['entityType']) || 'NON_PROFIT',
      is_political:
        brandState !== null
          ? bool(brandState['is_political'])
          : bool(profileState['is_political']),
      legal_entity_type: 'NON_PROFIT',
      phone: brandState ? str(brandState['phone']) : '',
      postalCode: brandState ? str(brandState['postalCode']) : '',
      state: brandState ? str(brandState['state']) : '',
      status,
      street: brandState ? str(brandState['street']) : '',
      usecase: 'POLITICAL',
      usecases: ['POLITICAL'],
      website: brandState ? str(brandState['website']) : '',
      will_send_over_2k: false,
      identity_id: identityId,
      ...(brandState ? { vertical: 'POLITICAL' } : {}),
    }
  }
}
