import {
  Controller,
  Get,
  HttpException,
  HttpStatus,
  Query,
} from '@nestjs/common'
import { HealthService } from './health.service'
import { PublicAccess } from '../authentication/decorators/PublicAccess.decorator'

@Controller('health')
export class HealthController {
  constructor(private readonly healthService: HealthService) {
    this.healthService = healthService
  }

  @PublicAccess()
  @Get()
  async getHealth(@Query('mode') mode?: string) {
    if (mode === 'live') {
      return 'OK'
    }
    if (await this.healthService.checkHealth()) {
      return 'OK'
    }
    throw new HttpException(
      'HEALTH CHECK FAILED',
      HttpStatus.SERVICE_UNAVAILABLE,
    )
  }
}
