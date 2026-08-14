import { Controller, Get, HttpException, HttpStatus } from '@nestjs/common'
import { HealthService } from './health.service'
import { PublicAccess } from '../authentication/decorators/PublicAccess.decorator'

// The ALB target-group health check hits GET /v1/health with no credentials
// and cannot present a bearer token, so this route must stay unauthenticated.
@PublicAccess()
@Controller('health')
export class HealthController {
  constructor(private readonly healthService: HealthService) {
    this.healthService = healthService
  }

  @Get()
  async getHealth() {
    if (await this.healthService.checkHealth()) {
      return 'OK'
    }
    throw new HttpException(
      'HEALTH CHECK FAILED',
      HttpStatus.SERVICE_UNAVAILABLE,
    )
  }
}
