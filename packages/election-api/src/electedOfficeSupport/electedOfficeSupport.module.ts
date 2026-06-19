import { Module } from '@nestjs/common'
import { ElectedOfficeSupportController } from './electedOfficeSupport.controller'
import { ElectedOfficeSupportService } from './electedOfficeSupport.service'

@Module({
  controllers: [ElectedOfficeSupportController],
  providers: [ElectedOfficeSupportService],
  exports: [ElectedOfficeSupportService],
})
export class ElectedOfficeSupportModule {}
