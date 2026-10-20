import { PublicAccess } from '@/authentication/decorators/PublicAccess.decorator'
import { FilesInterceptor } from '@/files/interceptors/files.interceptor'
import { ReqFile } from '@/files/decorators/ReqFiles.decorator'
import { FileUpload } from '@/files/files.types'
import { VENDOR_MODE } from '@/shared/util/appEnvironment.util'
import { VendorMockVendor, Prisma } from '@/generated/prisma'
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Post,
  Put,
  Res,
  UseInterceptors,
} from '@nestjs/common'
import { createHmac, randomUUID } from 'crypto'
import { addSeconds, differenceInMilliseconds, getUnixTime } from 'date-fns'
import { FastifyReply } from 'fastify'
import { VendorMockRecordService } from '../vendorMockRecord.service'

const MOCK_JWT_SECRET = 'peerly-mock-secret-2026'
const PHONE_LIST_COMPLETE_MS = 10_000
const MOCK_BALANCE_ID = 'mock-balance'

// HS256 JWT using only Node's built-in crypto — no external JWT library.
// PeerlyHttpService decodes the `exp` claim, so the token must be a real JWT.
const signHs256Jwt = (payload: Record<string, number | string>): string => {
  const header = Buffer.from(
    JSON.stringify({ alg: 'HS256', typ: 'JWT' }),
  ).toString('base64url')
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url')
  const sig = createHmac('sha256', MOCK_JWT_SECRET)
    .update(`${header}.${body}`)
    .digest('base64url')
  return `${header}.${body}.${sig}`
}

const jsonObj = (v: Prisma.JsonValue): Prisma.JsonObject =>
  typeof v === 'object' && v !== null && !Array.isArray(v) ? v : {}

@Controller('vendor-mocks/peerly')
@PublicAccess()
export class PeerlyP2pMockController {
  constructor(private readonly vendorMockRecord: VendorMockRecordService) {}

  // AUTH

  @Post('token-auth')
  tokenAuth() {
    this.assertMockMode()
    const exp = getUnixTime(addSeconds(new Date(), 3600))
    return { token: signHs256Jwt({ exp, accountNumber: 'mock-peerly' }) }
  }

  // P2P JOBS

  @Post('1to1/jobs')
  @HttpCode(HttpStatus.CREATED)
  async createJob(
    @Body() body: Record<string, Prisma.JsonValue>,
    @Res({ passthrough: true }) res: FastifyReply,
  ) {
    this.assertMockMode()
    const externalId = randomUUID()
    const today = new Date().toISOString().slice(0, 10)
    const state: Prisma.InputJsonObject = {
      id: externalId,
      name: String(body['name'] ?? 'mock-job'),
      status: 'pending',
      leads_remaining: 0,
      start_date: today,
      end_date: today,
      templates: [],
      deleted: false,
      can_use_mms: true,
    }
    await this.vendorMockRecord.upsert(
      VendorMockVendor.peerly,
      'p2p_job',
      externalId,
      state,
      undefined,
      body,
    )
    res.header('Location', `/1to1/jobs/${externalId}`)
    return {
      id: externalId,
      name: state['name'],
      status: state['status'],
      templates: [],
    }
  }

  @Get('1to1/jobs')
  async listJobs() {
    this.assertMockMode()
    const records = await this.vendorMockRecord.findMany({
      where: { vendor: VendorMockVendor.peerly, kind: 'p2p_job' },
    })
    return {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      results: records.map((r) => jsonObj(r.state as Prisma.JsonValue)),
    }
  }

  @Get('1to1/jobs/:id')
  async getJob(@Param('id') id: string) {
    this.assertMockMode()
    const record = await this.findJobRecord(id)
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
    return jsonObj(record.state as Prisma.JsonValue)
  }

  @Put('1to1/jobs/:id')
  async updateJob(
    @Param('id') id: string,
    @Body() body: Record<string, Prisma.JsonValue>,
  ) {
    this.assertMockMode()
    const record = await this.findJobRecord(id)
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
    const current = jsonObj(record.state as Prisma.JsonValue)
    const merged: Prisma.InputJsonObject = { ...current, ...body }
    await this.vendorMockRecord.upsert(
      VendorMockVendor.peerly,
      'p2p_job',
      id,
      merged,
      undefined,
      body,
    )
    return merged
  }

  @Delete('1to1/jobs/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteJob(@Param('id') id: string) {
    this.assertMockMode()
    const record = await this.findJobRecord(id)
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
    const current = jsonObj(record.state as Prisma.JsonValue)
    await this.vendorMockRecord.upsert(VendorMockVendor.peerly, 'p2p_job', id, {
      ...current,
      deleted: true,
    })
  }

  @Post('1to1/jobs/:id/assignlist')
  async assignJobList(
    @Param('id') id: string,
    @Body() body: Record<string, Prisma.JsonValue>,
  ) {
    this.assertMockMode()
    const record = await this.findJobRecord(id)
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
    const current = jsonObj(record.state as Prisma.JsonValue)
    const phoneListId = body['list_id']
    await this.vendorMockRecord.upsert(VendorMockVendor.peerly, 'p2p_job', id, {
      ...current,
      phoneListId,
    })
    return {}
  }

  @Post('1to1/jobs/:id/send_test_message')
  async sendJobTestMessage(@Param('id') id: string) {
    this.assertMockMode()
    await this.findJobRecord(id)
    return {}
  }

  @Get('1to1/jobs/:id/questionresponses')
  async getJobQuestionResponses(@Param('id') id: string) {
    this.assertMockMode()
    await this.findJobRecord(id)
    return { results: [] }
  }

  // P2P CANVASSERS AND TESTS

  @Post('v2/p2p/:id/request_canvassers')
  async requestCanvassers(@Param('id') id: string) {
    this.assertMockMode()
    const record = await this.findJobRecord(id)
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
    const current = jsonObj(record.state as Prisma.JsonValue)
    await this.vendorMockRecord.upsert(VendorMockVendor.peerly, 'p2p_job', id, {
      ...current,
      canvassersBooked: true,
    })
    return {}
  }

  @Post('v2/p2p/:id/clear_canvassers')
  async clearCanvassers(@Param('id') id: string) {
    this.assertMockMode()
    const record = await this.findJobRecord(id)
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
    const current = jsonObj(record.state as Prisma.JsonValue)
    await this.vendorMockRecord.upsert(VendorMockVendor.peerly, 'p2p_job', id, {
      ...current,
      canvassersBooked: false,
    })
    return {}
  }

  @Get('v2/p2p/:id/tests')
  async listP2pTests(@Param('id') id: string) {
    this.assertMockMode()
    await this.findJobRecord(id)
    return { results: [] }
  }

  @Post('v2/p2p/:id/tests')
  @HttpCode(HttpStatus.CREATED)
  async createP2pTest(@Param('id') id: string) {
    this.assertMockMode()
    await this.findJobRecord(id)
    return { results: [] }
  }

  @Get('v2/p2p/:id/detailedstats')
  async getDetailedStats(@Param('id') id: string) {
    this.assertMockMode()
    await this.findJobRecord(id)
    return { messages: {}, delivery_receipts: {} }
  }

  @Get('v2/p2p/:id/cdrs')
  async getCdrs(@Param('id') id: string) {
    this.assertMockMode()
    await this.findJobRecord(id)
    return { results: [] }
  }

  // PHONE LISTS

  // Must be declared before phonelists/:id to take precedence.
  @Get('phonelists/listByAccount')
  async listPhoneListsByAccount() {
    this.assertMockMode()
    const records = await this.vendorMockRecord.findMany({
      where: { vendor: VendorMockVendor.peerly, kind: 'phone_list' },
    })
    return records.map((r) => {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      const state = jsonObj(r.state as Prisma.JsonValue)
      return {
        list_id: Number(state['listId'] ?? 0),
        list_name: String(state['listName'] ?? ''),
        list_state: this.resolveListState(state, r.createdAt),
      }
    })
  }

  // The real Peerly client posts multipart — use FilesInterceptor so the CSV
  // file buffer lands in req.fileUploads and form fields populate req.body.
  @Post('phonelists')
  @HttpCode(HttpStatus.CREATED)
  @UseInterceptors(FilesInterceptor('file'))
  async createPhoneList(
    @ReqFile() file: FileUpload | undefined,
    @Body() body: Record<string, string>,
  ) {
    this.assertMockMode()
    const token = randomUUID()
    const listId = Math.floor(Math.random() * 900_000) + 100_000
    const listName = body['list_name'] ?? 'mock-list'

    let count = 0
    if (file) {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      const csv = (file.data as Buffer).toString('utf8')
      const rows = csv.split('\n').filter((l) => l.trim().length > 0)
      count = Math.max(0, rows.length - 1)
    }

    await this.vendorMockRecord.upsert(
      VendorMockVendor.peerly,
      'phone_list',
      token,
      { status: 'PENDING', count, token, listId, listName },
    )

    return { Data: { token } }
  }

  @Get('phonelists/:token/checkstatus')
  async checkPhoneListStatus(@Param('token') token: string) {
    this.assertMockMode()
    const records = await this.vendorMockRecord.findMany({
      where: {
        vendor: VendorMockVendor.peerly,
        kind: 'phone_list',
        externalId: token,
      },
    })
    const record = records[0]
    if (!record) throw new NotFoundException()
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
    const state = jsonObj(record.state as Prisma.JsonValue)
    const listState = this.resolveListState(state, record.createdAt)
    const isActive = listState === 'ACTIVE'
    return {
      Data: {
        list_status: listState,
        list_state: listState,
        ...(isActive && { list_id: Number(state['listId'] ?? 0) }),
      },
    }
  }

  @Get('phonelists/:id')
  async getPhoneList(@Param('id') id: string) {
    this.assertMockMode()
    const records = await this.vendorMockRecord.findMany({
      where: {
        vendor: VendorMockVendor.peerly,
        kind: 'phone_list',
        externalId: id,
      },
    })
    const record = records[0]
    if (!record) throw new NotFoundException()
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
    return jsonObj(record.state as Prisma.JsonValue)
  }

  @Post('phonelists/addcontact')
  addPhoneListContact() {
    this.assertMockMode()
    return {}
  }

  // MEDIA, SCHEDULE, BALANCE

  @Post('v2/media')
  @HttpCode(HttpStatus.CREATED)
  uploadMedia() {
    this.assertMockMode()
    return { media_id: randomUUID(), status: 'ready' }
  }

  @Post('schedule')
  @HttpCode(HttpStatus.CREATED)
  createSchedule(@Body() body: Record<string, Prisma.JsonValue>) {
    this.assertMockMode()
    const scheduleId = Math.floor(Math.random() * 900_000) + 100_000
    const scheduleName = String(body['schedule_name'] ?? 'mock-schedule')
    return {
      Data: {
        schedule_id: scheduleId,
        schedule_name: scheduleName,
        account: 'mock',
      },
    }
  }

  @Get('accounts/:acct/balance')
  async getBalance() {
    this.assertMockMode()
    const records = await this.vendorMockRecord.findMany({
      where: {
        vendor: VendorMockVendor.peerly,
        kind: 'balance',
        externalId: MOCK_BALANCE_ID,
      },
    })
    const balance = records.length > 0 ? 0 : 1_000_000
    return { balance, credit_limit: 0 }
  }

  private assertMockMode() {
    if (VENDOR_MODE !== 'mock') throw new NotFoundException()
  }

  private async findJobRecord(id: string) {
    const records = await this.vendorMockRecord.findMany({
      where: {
        vendor: VendorMockVendor.peerly,
        kind: 'p2p_job',
        externalId: id,
      },
    })
    const record = records[0]
    if (!record) throw new NotFoundException()
    return record
  }

  // A phone list auto-advances to ACTIVE once its record is older than
  // PHONE_LIST_COMPLETE_MS. The p2p.phoneListFinish runJob backdates
  // createdAt to trigger this in tests without waiting.
  private resolveListState(state: Prisma.JsonObject, createdAt: Date): string {
    if (state['status'] === 'COMPLETE') return 'ACTIVE'
    const elapsed = differenceInMilliseconds(new Date(), createdAt)
    return elapsed >= PHONE_LIST_COMPLETE_MS ? 'ACTIVE' : 'PENDING'
  }
}
