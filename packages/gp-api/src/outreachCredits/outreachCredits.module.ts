import { Module } from '@nestjs/common'
import { OutreachCreditsService } from './services/outreachCredits.service'

@Module({
  providers: [OutreachCreditsService],
  exports: [OutreachCreditsService],
})
export class OutreachCreditsModule {}
