import { PublicAccess } from '@/authentication/decorators/PublicAccess.decorator'
import { VENDOR_MODE } from '@/shared/util/appEnvironment.util'
import {
  Controller,
  Get,
  HttpException,
  HttpStatus,
  NotFoundException,
  Post,
} from '@nestjs/common'

@Controller('vendor-mocks/peerly')
@PublicAccess()
export class Peerly10DlcMockController {
  @Post('identities')
  createIdentity() {
    this.assertMockMode()
    this.notImplemented()
  }

  @Get('identities/listByAccount')
  listIdentitiesByAccount() {
    this.assertMockMode()
    this.notImplemented()
  }

  @Post('identities/:id/submitProfile')
  submitProfile() {
    this.assertMockMode()
    this.notImplemented()
  }

  @Get('identities/:id/getProfile')
  getProfile() {
    this.assertMockMode()
    this.notImplemented()
  }

  @Post('v2/tdlc/:id/submit')
  submitTdlc() {
    this.assertMockMode()
    this.notImplemented()
  }

  @Post('v2/tdlc/:id/approve')
  approveTdlc() {
    this.assertMockMode()
    this.notImplemented()
  }

  @Get('v2/tdlc/:id/finalize')
  finalizeTdlc() {
    this.assertMockMode()
    this.notImplemented()
  }

  @Post('v2/tdlc/:id/submit_cv')
  submitCv() {
    this.assertMockMode()
    this.notImplemented()
  }

  @Get('v2/tdlc/:id/retrieve_cv')
  retrieveCv() {
    this.assertMockMode()
    this.notImplemented()
  }

  @Post('v2/tdlc/:id/verify_pin')
  verifyPin() {
    this.assertMockMode()
    this.notImplemented()
  }

  @Post('v2/tdlc/:id/resend_pin')
  resendPin() {
    this.assertMockMode()
    this.notImplemented()
  }

  @Post('v2/tdlc/:id/create_cv_token')
  createCvToken() {
    this.assertMockMode()
    this.notImplemented()
  }

  @Get('v2/tdlc/:id/get_usecases')
  getUsecases() {
    this.assertMockMode()
    this.notImplemented()
  }

  private assertMockMode() {
    if (VENDOR_MODE !== 'mock') throw new NotFoundException()
  }

  private notImplemented(): never {
    throw new HttpException('Not implemented', HttpStatus.NOT_IMPLEMENTED)
  }
}
