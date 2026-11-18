import { Module } from '@nestjs/common'
import { DbChangeCleanupService } from './dbChangeCleanup.service'
import { DbChangeHealthService } from './dbChangeHealth.service'
import { DbChangeRelayService } from './dbChangeRelay.service'

// The relay runs with the app: nothing that serves a request imports this,
// and the cleanup and the health check run from their schedules
// (src/jobs/jobs.registry.ts).
@Module({
  providers: [
    DbChangeRelayService,
    DbChangeCleanupService,
    DbChangeHealthService,
  ],
  exports: [
    DbChangeRelayService,
    DbChangeCleanupService,
    DbChangeHealthService,
  ],
})
export class DbChangesModule {}
