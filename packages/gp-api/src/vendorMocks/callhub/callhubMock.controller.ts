import { PublicAccess } from '@/authentication/decorators/PublicAccess.decorator'
import { VENDOR_MODE } from '@/shared/util/appEnvironment.util'
import { VendorMockVendor, Prisma } from '@/generated/prisma'
import {
  BadGatewayException,
  Body,
  Controller,
  Get,
  Headers,
  HttpException,
  HttpStatus,
  NotFoundException,
  Param,
  Patch,
  Post,
  Put,
  UnauthorizedException,
} from '@nestjs/common'
import { randomUUID } from 'crypto'
import { VendorMockRecordService } from '../vendorMockRecord.service'
import { CALLHUB_MOCK_API_KEY } from '@/vendors/callhub/config/callhubBaseConfig'

// The rate a create lands at before gp-api PATCHes it up — real CallHub clamps
// every create to an account default regardless of the POSTed frequency.
const CLAMPED_CREATE_FREQUENCY = 60

// Real CallHub imports a phonebook by fetching `csv_url` (a presigned S3
// GET), so the mock does too: staging polls numbers_count until it reaches
// the audience size, and only the CSV knows that size.
// Hostname is restricted to .amazonaws.com: the mock-key is a public constant
// so any request with it passes assertAuth; without a hostname allowlist an
// attacker on an internet-facing preview can SSRF to arbitrary HTTPS
// endpoints by posting csv_url to bulk_create.
const fetchCsv = async (url: string): Promise<string> => {
  const parsed = new URL(url)
  if (parsed.protocol !== 'https:') {
    throw new BadGatewayException('csv_url must be HTTPS')
  }
  if (!parsed.hostname.endsWith('.amazonaws.com')) {
    throw new BadGatewayException('csv_url must be an S3 presigned URL')
  }
  const res = await fetch(url)
  if (!res.ok) {
    throw new BadGatewayException(`CSV fetch failed: ${res.status}`)
  }
  return res.text()
}

@Controller('vendor-mocks/callhub')
@PublicAccess()
export class CallhubMockController {
  constructor(private readonly vendorMockRecord: VendorMockRecordService) {}

  @Post('v1/numbers/rent')
  async rentNumber(@Headers('authorization') auth: string | undefined) {
    this.assertMockMode()
    this.assertAuth(auth)
    const externalId = randomUUID()
    await this.vendorMockRecord.upsert(
      VendorMockVendor.callhub,
      'number',
      externalId,
      { phone_number: '+15551234567', status: 'rented' },
    )
    return { phone_number: '+15551234567' }
  }

  @Get('v1/numbers/rented_calling_numbers')
  async rentedCallingNumbers(
    @Headers('authorization') auth: string | undefined,
  ) {
    this.assertMockMode()
    this.assertAuth(auth)
    const records = await this.vendorMockRecord.findMany({
      where: { vendor: VendorMockVendor.callhub, kind: 'number' },
    })
    const results = records.map((r) => {
      // TS7: findMany passthrough resolves JSON fields as unknown; safe cast.
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      const state = jsonObj(r.state as Prisma.JsonValue)
      return { phone_number: String(state['phone_number'] ?? '') }
    })
    return { count: results.length, next: null, previous: null, results }
  }

  // The client posts multipart, which @fastify/multipart leaves off `body`.
  @Post('v1/media/upload')
  async uploadMedia(
    @Headers('authorization') auth: string | undefined,
    @Body() body: Record<string, string> | undefined,
  ) {
    this.assertMockMode()
    this.assertAuth(auth)
    const externalId = randomUUID()
    const url = `https://mock-media/${externalId}`
    await this.vendorMockRecord.upsert(
      VendorMockVendor.callhub,
      'media',
      externalId,
      { filename: body?.['filename'] ?? null, url },
    )
    return { data: { media_file_id: externalId, media_url: url } }
  }

  @Post('v1/phonebooks')
  async createPhonebook(
    @Headers('authorization') auth: string | undefined,
    @Body() body: Record<string, string>,
  ) {
    this.assertMockMode()
    this.assertAuth(auth)
    const externalId = randomUUID()
    const name = body['name'] ?? 'mock-phonebook'
    await this.vendorMockRecord.upsert(
      VendorMockVendor.callhub,
      'phonebook',
      externalId,
      { name, count: 0, status: 'COMPLETE' },
    )
    return { pk_str: externalId, name }
  }

  @Get('v1/phonebooks')
  async listPhonebooks(@Headers('authorization') auth: string | undefined) {
    this.assertMockMode()
    this.assertAuth(auth)
    const records = await this.vendorMockRecord.findMany({
      where: { vendor: VendorMockVendor.callhub, kind: 'phonebook' },
    })
    const results = records.map((r) => {
      // TS7: findMany passthrough resolves JSON fields as unknown; safe cast.
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      const state = jsonObj(r.state as Prisma.JsonValue)
      return { pk_str: r.externalId, name: String(state['name'] ?? '') }
    })
    return { count: results.length, next: null, previous: null, results }
  }

  @Get('v1/phonebooks/:pk/numbers_count')
  async phonebookNumbersCount(
    @Headers('authorization') auth: string | undefined,
    @Param('pk') pk: string,
  ) {
    this.assertMockMode()
    this.assertAuth(auth)
    const records = await this.vendorMockRecord.findMany({
      where: {
        vendor: VendorMockVendor.callhub,
        kind: 'phonebook',
        externalId: pk,
      },
    })
    const record = records[0]
    if (!record) throw new NotFoundException()
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
    const state = jsonObj(record.state as Prisma.JsonValue)
    return {
      phonenumber_count: Number(state['count'] ?? 0),
      mobilenumber_count: null,
    }
  }

  @Post('v1/contacts/bulk_create')
  async bulkCreate(
    @Headers('authorization') auth: string | undefined,
    @Body() body: Record<string, string>,
  ) {
    this.assertMockMode()
    this.assertAuth(auth)
    const phonebookId = body['phonebook_id']
    if (phonebookId) {
      const records = await this.vendorMockRecord.findMany({
        where: {
          vendor: VendorMockVendor.callhub,
          kind: 'phonebook',
          externalId: phonebookId,
        },
      })
      const record = records[0]
      if (record) {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
        const state = jsonObj(record.state as Prisma.JsonValue)
        const current = Number(state['count'] ?? 0)
        const csv =
          body['csv'] ??
          (body['csv_url'] ? await fetchCsv(body['csv_url']) : undefined)
        const delta = csv
          ? csv.split('\n').filter((l) => l.trim().length > 0).length - 1
          : 1
        await this.vendorMockRecord.setFlag(
          VendorMockVendor.callhub,
          'phonebook',
          phonebookId,
          'count',
          current + (delta > 0 ? delta : 0),
        )
      }
    }
    return { message: null }
  }

  @Post('v1/vb_campaign')
  async createVbCampaign(
    @Headers('authorization') auth: string | undefined,
    @Body() body: Record<string, string>,
  ) {
    this.assertMockMode()
    this.assertAuth(auth)
    const name = body['name'] ?? 'mock-campaign'
    // callhub.campaign.fail: fail this campaign's next create once, in
    // CallHub's DRF `{ detail }` error shape.
    const failFor =
      await this.vendorMockRecord.campaignIdForRobocallBroadcast(name)
    if (
      failFor !== undefined &&
      (await this.vendorMockRecord.consumeCallhubCreateFail(failFor))
    ) {
      throw new HttpException(
        { detail: 'Mock CallHub failure: service temporarily unavailable.' },
        HttpStatus.SERVICE_UNAVAILABLE,
      )
    }
    const externalId = randomUUID()
    // Keep the phonebook ids so the records route can surface the audience
    // a campaign was staged against (the campaign body carries no org link).
    const phonebooks: unknown = body['phonebooks']
    // Real CallHub CLAMPS the create to an account default regardless of the
    // POSTed frequency; gp-api PATCHes it up afterward (see the PATCH route
    // below). Mirror that so the create→PATCH→applied flow is exercised.
    const frequency = CLAMPED_CREATE_FREQUENCY
    await this.vendorMockRecord.upsert(
      VendorMockVendor.callhub,
      'vb_campaign',
      externalId,
      {
        status: 2,
        name,
        frequency,
        phonebooks: Array.isArray(phonebooks) ? phonebooks.map(String) : [],
      },
    )
    return { pk_str: externalId, name, frequency }
  }

  @Patch('v1/voice_broadcasts/:pk')
  async patchVoiceBroadcast(
    @Headers('authorization') auth: string | undefined,
    @Param('pk') pk: string,
    @Body() body: Record<string, string>,
  ) {
    this.assertMockMode()
    this.assertAuth(auth)
    const records = await this.vendorMockRecord.findMany({
      where: {
        vendor: VendorMockVendor.callhub,
        kind: 'vb_campaign',
        externalId: pk,
      },
    })
    const record = records[0]
    if (!record) throw new NotFoundException()
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
    const state = jsonObj(record.state as Prisma.JsonValue)
    const frequency =
      body['frequency'] != null
        ? Number(body['frequency'])
        : Number(state['frequency'] ?? CLAMPED_CREATE_FREQUENCY)
    await this.vendorMockRecord.setFlag(
      VendorMockVendor.callhub,
      'vb_campaign',
      pk,
      'frequency',
      frequency,
    )
    return {
      pk_str: pk,
      status: Number(state['status'] ?? 2),
      frequency,
    }
  }

  @Put('v1/voice_broadcasts/:pk')
  async updateVoiceBroadcast(
    @Headers('authorization') auth: string | undefined,
    @Param('pk') pk: string,
    @Body() body: Record<string, string>,
  ) {
    this.assertMockMode()
    this.assertAuth(auth)
    const records = await this.vendorMockRecord.findMany({
      where: {
        vendor: VendorMockVendor.callhub,
        kind: 'vb_campaign',
        externalId: pk,
      },
    })
    const record = records[0]
    if (!record) throw new NotFoundException()
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
    const state = jsonObj(record.state as Prisma.JsonValue)
    const requestedStatus = Number(body['status'])
    const newStatus =
      requestedStatus === 1 || requestedStatus === 3
        ? requestedStatus
        : Number(state['status'] ?? 2)
    await this.vendorMockRecord.setFlag(
      VendorMockVendor.callhub,
      'vb_campaign',
      pk,
      'status',
      newStatus,
    )
    return { pk_str: pk, status: newStatus }
  }

  @Get('v1/voice_broadcasts/:pk')
  async getVoiceBroadcast(
    @Headers('authorization') auth: string | undefined,
    @Param('pk') pk: string,
  ) {
    this.assertMockMode()
    this.assertAuth(auth)
    const records = await this.vendorMockRecord.findMany({
      where: {
        vendor: VendorMockVendor.callhub,
        kind: 'vb_campaign',
        externalId: pk,
      },
    })
    const record = records[0]
    if (!record) throw new NotFoundException()
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
    const state = jsonObj(record.state as Prisma.JsonValue)
    return {
      url: `http://mock-callhub/v1/voice_broadcasts/${pk}/`,
      name: String(state['name'] ?? ''),
      status: Number(state['status'] ?? 2),
      frequency:
        state['frequency'] != null
          ? Number(state['frequency'])
          : CLAMPED_CREATE_FREQUENCY,
      phonebook: null,
    }
  }

  @Get('v1/export_data/export_:id')
  async exportData(
    @Headers('authorization') auth: string | undefined,
    @Param('id') id: string,
  ) {
    this.assertMockMode()
    this.assertAuth(auth)
    const campaigns = await this.vendorMockRecord.findMany({
      where: {
        vendor: VendorMockVendor.callhub,
        kind: 'vb_campaign',
        externalId: id,
      },
    })
    if (!campaigns[0]) throw new NotFoundException()
    const phonebooks = await this.vendorMockRecord.findMany({
      where: { vendor: VendorMockVendor.callhub, kind: 'phonebook' },
    })
    const totalCount = phonebooks.reduce((sum, r) => {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      return sum + Number(jsonObj(r.state as Prisma.JsonValue)['count'] ?? 0)
    }, 0)
    return {
      state: 'SUCCESS',
      total_calls: totalCount,
      answered: totalCount,
      data: { url: `https://mock-export/${id}` },
    }
  }

  @Get('v1/dnc_contacts')
  async dncContacts(@Headers('authorization') auth: string | undefined) {
    this.assertMockMode()
    this.assertAuth(auth)
    return { count: 0, next: null, previous: null, results: [] }
  }

  private assertMockMode() {
    if (VENDOR_MODE !== 'mock') throw new NotFoundException()
  }

  // In mock mode the real client always sends CALLHUB_MOCK_API_KEY, even
  // where CALLHUB_API_KEY is also set (PR previews share it with dev).
  // The fallback to any non-empty auth when CALLHUB_API_KEY is unset is
  // intentionally absent: mock routes are internet-facing on previews and
  // must not accept arbitrary tokens.
  private assertAuth(auth: string | undefined) {
    const expectedKey = process.env.CALLHUB_API_KEY
    const accepted =
      auth === `Token ${CALLHUB_MOCK_API_KEY}` ||
      (!!expectedKey && auth === `Token ${expectedKey}`)
    if (!accepted) throw new UnauthorizedException()
  }
}

const jsonObj = (v: Prisma.JsonValue): Prisma.JsonObject =>
  typeof v === 'object' && v !== null && !Array.isArray(v) ? v : {}
