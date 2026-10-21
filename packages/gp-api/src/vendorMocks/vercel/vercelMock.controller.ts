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
} from '@nestjs/common'

@Controller('vendor-mocks/vercel')
@PublicAccess()
export class VercelMockController {
  @Get('v9/projects/:idOrName/domains/:domain')
  getProjectDomain() {
    this.assertMockMode()
    this.notImplemented()
  }

  @Post('v10/projects/:idOrName/domains')
  addProjectDomain() {
    this.assertMockMode()
    this.notImplemented()
  }

  @Delete('v9/projects/:idOrName/domains/:domain')
  removeProjectDomain() {
    this.assertMockMode()
    this.notImplemented()
  }

  @Post('v9/projects/:idOrName/domains/:domain/verify')
  verifyProjectDomain() {
    this.assertMockMode()
    this.notImplemented()
  }

  @Get('v1/registrar/domains/:domain/price')
  getDomainPrice() {
    this.assertMockMode()
    this.notImplemented()
  }

  @Post('v1/registrar/domains/:domain/buy')
  buySingleDomain() {
    this.assertMockMode()
    this.notImplemented()
  }

  @Get('v1/registrar/orders/:orderId')
  getOrder() {
    this.assertMockMode()
    this.notImplemented()
  }

  @Get('v1/registrar/domains/:domain/auth-code')
  getDomainAuthCode() {
    this.assertMockMode()
    this.notImplemented()
  }

  @Get('v5/domains/:domain')
  getDomain() {
    this.assertMockMode()
    this.notImplemented()
  }

  @Get('v5/domains')
  getDomains() {
    this.assertMockMode()
    this.notImplemented()
  }

  @Get('v5/domains/:domain/records')
  getDnsRecords() {
    this.assertMockMode()
    this.notImplemented()
  }

  @Post('v2/domains/:domain/records')
  createDnsRecord() {
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
