import { PublicAccess } from '@/authentication/decorators/PublicAccess.decorator'
import { VENDOR_MODE } from '@/shared/util/appEnvironment.util'
import {
  Controller,
  HttpException,
  HttpStatus,
  NotFoundException,
  Post,
} from '@nestjs/common'

@Controller('vendor-mocks/route53')
@PublicAccess()
export class Route53MockController {
  @Post()
  handleOperation() {
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
