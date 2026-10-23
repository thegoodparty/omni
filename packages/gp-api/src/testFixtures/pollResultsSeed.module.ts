import { ElectedOfficeModule } from '@/electedOffice/electedOffice.module'
import { Module, forwardRef } from '@nestjs/common'
import { PollResultsSeedService } from './services/pollResultsSeed.service'
import { TestFixturesPollResultsController } from './testFixturesPollResults.controller'

@Module({
  imports: [forwardRef(() => ElectedOfficeModule)],
  controllers: [TestFixturesPollResultsController],
  providers: [PollResultsSeedService],
})
export class PollResultsSeedModule {}
