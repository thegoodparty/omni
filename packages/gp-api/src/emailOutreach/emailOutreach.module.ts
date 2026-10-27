import { Module } from '@nestjs/common'
import { EmailOutreachQueueService } from './services/emailOutreachQueue.service'

@Module({
  providers: [EmailOutreachQueueService],
  exports: [EmailOutreachQueueService],
})
export class EmailOutreachModule {}
