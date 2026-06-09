import { Module } from '@nestjs/common'
import { HealthService } from './health.service'
import { HealthController } from './health.controller'
import { VersionController } from './version.controller'
import { AuthenticationModule } from '../authentication/authentication.module'

@Module({
  imports: [AuthenticationModule],
  controllers: [HealthController, VersionController],
  providers: [HealthService],
})
export class HealthModule {}
