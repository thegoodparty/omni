import { Module } from '@nestjs/common'
import { ElectedOfficeSupportService } from './electedOfficeSupport.service'

@Module({
  providers: [ElectedOfficeSupportService],
  exports: [ElectedOfficeSupportService],
})
export class ElectedOfficeSupportModule {}
