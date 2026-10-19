import { PublicAccess } from '@/authentication/decorators/PublicAccess.decorator'
import { VENDOR_MODE } from '@/shared/util/appEnvironment.util'
import { VendorMockVendor, Prisma } from '@/generated/prisma'
import {
  Body,
  Controller,
  Get,
  Headers,
  NotFoundException,
  Param,
  Post,
  Put,
  UnauthorizedException,
} from '@nestjs/common'
import { randomUUID } from 'crypto'
import { VendorMockRecordService } from '../vendorMockRecord.service'

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

  @Post('v1/media/upload')
  async uploadMedia(
    @Headers('authorization') auth: string | undefined,
    @Body() body: Record<string, string>,
  ) {
    this.assertMockMode()
    this.assertAuth(auth)
    const externalId = randomUUID()
    const url = `https://mock-media/${externalId}`
    await this.vendorMockRecord.upsert(
      VendorMockVendor.callhub,
      'media',
      externalId,
      { filename: body['filename'] ?? null, url },
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
        const csv = body['csv']
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
    const externalId = randomUUID()
    const name = body['name'] ?? 'mock-campaign'
    await this.vendorMockRecord.upsert(
      VendorMockVendor.callhub,
      'vb_campaign',
      externalId,
      { status: 2, name },
    )
    return { pk_str: externalId, name }
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
      frequency: null,
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

  private assertAuth(auth: string | undefined) {
    const expectedKey = process.env.CALLHUB_API_KEY
    if (!auth || (expectedKey && auth !== `Token ${expectedKey}`)) {
      throw new UnauthorizedException()
    }
  }
}

const jsonObj = (v: Prisma.JsonValue): Prisma.JsonObject =>
  typeof v === 'object' && v !== null && !Array.isArray(v) ? v : {}
