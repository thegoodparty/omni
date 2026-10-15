import { Module } from '@nestjs/common'
import { OutreachReportBackService } from './services/outreachReportBack.service'

// Its own module, importing nothing, so the cards, the contacts sampler, the
// SMS create and both agents can read it without pulling OutreachModule's
// graph in after them.
@Module({
  providers: [OutreachReportBackService],
  exports: [OutreachReportBackService],
})
export class OutreachReportBackModule {}
