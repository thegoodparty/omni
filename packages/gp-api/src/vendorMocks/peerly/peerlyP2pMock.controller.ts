import { PublicAccess } from '@/authentication/decorators/PublicAccess.decorator'
import { VENDOR_MODE } from '@/shared/util/appEnvironment.util'
import {
  Controller,
  Delete,
  Get,
  HttpException,
  HttpStatus,
  NotFoundException,
  Post,
  Put,
} from '@nestjs/common'

@Controller('vendor-mocks/peerly')
@PublicAccess()
export class PeerlyP2pMockController {
  @Post('token-auth')
  tokenAuth() {
    this.assertMockMode()
    throw new HttpException('Not implemented', HttpStatus.NOT_IMPLEMENTED)
  }

  @Post('1to1/jobs')
  createJob() {
    this.assertMockMode()
    throw new HttpException('Not implemented', HttpStatus.NOT_IMPLEMENTED)
  }

  @Get('1to1/jobs')
  listJobs() {
    this.assertMockMode()
    throw new HttpException('Not implemented', HttpStatus.NOT_IMPLEMENTED)
  }

  @Get('1to1/jobs/:id')
  getJob() {
    this.assertMockMode()
    throw new HttpException('Not implemented', HttpStatus.NOT_IMPLEMENTED)
  }

  @Put('1to1/jobs/:id')
  updateJob() {
    this.assertMockMode()
    throw new HttpException('Not implemented', HttpStatus.NOT_IMPLEMENTED)
  }

  @Delete('1to1/jobs/:id')
  deleteJob() {
    this.assertMockMode()
    throw new HttpException('Not implemented', HttpStatus.NOT_IMPLEMENTED)
  }

  @Post('1to1/jobs/:id/assignlist')
  assignJobList() {
    this.assertMockMode()
    throw new HttpException('Not implemented', HttpStatus.NOT_IMPLEMENTED)
  }

  @Post('1to1/jobs/:id/send_test_message')
  sendJobTestMessage() {
    this.assertMockMode()
    throw new HttpException('Not implemented', HttpStatus.NOT_IMPLEMENTED)
  }

  @Get('1to1/jobs/:id/questionresponses')
  getJobQuestionResponses() {
    this.assertMockMode()
    throw new HttpException('Not implemented', HttpStatus.NOT_IMPLEMENTED)
  }

  @Post('v2/p2p/:id/request_canvassers')
  requestCanvassers() {
    this.assertMockMode()
    throw new HttpException('Not implemented', HttpStatus.NOT_IMPLEMENTED)
  }

  @Post('v2/p2p/:id/clear_canvassers')
  clearCanvassers() {
    this.assertMockMode()
    throw new HttpException('Not implemented', HttpStatus.NOT_IMPLEMENTED)
  }

  @Get('v2/p2p/:id/tests')
  listP2pTests() {
    this.assertMockMode()
    throw new HttpException('Not implemented', HttpStatus.NOT_IMPLEMENTED)
  }

  @Post('v2/p2p/:id/tests')
  createP2pTest() {
    this.assertMockMode()
    throw new HttpException('Not implemented', HttpStatus.NOT_IMPLEMENTED)
  }

  @Get('v2/p2p/:id/detailedstats')
  getDetailedStats() {
    this.assertMockMode()
    throw new HttpException('Not implemented', HttpStatus.NOT_IMPLEMENTED)
  }

  @Get('v2/p2p/:id/cdrs')
  getCdrs() {
    this.assertMockMode()
    throw new HttpException('Not implemented', HttpStatus.NOT_IMPLEMENTED)
  }

  @Post('phonelists')
  createPhoneList() {
    this.assertMockMode()
    throw new HttpException('Not implemented', HttpStatus.NOT_IMPLEMENTED)
  }

  @Get('phonelists/listByAccount')
  listPhoneListsByAccount() {
    this.assertMockMode()
    throw new HttpException('Not implemented', HttpStatus.NOT_IMPLEMENTED)
  }

  @Get('phonelists/:id')
  getPhoneList() {
    this.assertMockMode()
    throw new HttpException('Not implemented', HttpStatus.NOT_IMPLEMENTED)
  }

  @Get('phonelists/:token/checkstatus')
  checkPhoneListStatus() {
    this.assertMockMode()
    throw new HttpException('Not implemented', HttpStatus.NOT_IMPLEMENTED)
  }

  @Post('phonelists/addcontact')
  addPhoneListContact() {
    this.assertMockMode()
    throw new HttpException('Not implemented', HttpStatus.NOT_IMPLEMENTED)
  }

  @Post('v2/media')
  uploadMedia() {
    this.assertMockMode()
    throw new HttpException('Not implemented', HttpStatus.NOT_IMPLEMENTED)
  }

  @Post('schedule')
  schedule() {
    this.assertMockMode()
    throw new HttpException('Not implemented', HttpStatus.NOT_IMPLEMENTED)
  }

  @Get('accounts/:acct/balance')
  getBalance() {
    this.assertMockMode()
    throw new HttpException('Not implemented', HttpStatus.NOT_IMPLEMENTED)
  }

  private assertMockMode() {
    if (VENDOR_MODE !== 'mock') throw new NotFoundException()
  }
}
