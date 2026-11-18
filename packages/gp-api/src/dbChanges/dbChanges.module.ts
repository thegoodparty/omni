import { Module } from '@nestjs/common'
import { DbChangeCleanupService } from './dbChangeCleanup.service'
import { DbChangeRelayService } from './dbChangeRelay.service'

// The relay runs with the app: nothing that serves a request imports this,
// and the cleanup runs from its schedule (src/jobs/jobs.registry.ts).
@Module({
  providers: [DbChangeRelayService, DbChangeCleanupService],
  exports: [DbChangeRelayService, DbChangeCleanupService],
})
export class DbChangesModule {}
