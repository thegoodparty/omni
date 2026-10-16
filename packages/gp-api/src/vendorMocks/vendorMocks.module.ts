import { Module } from '@nestjs/common'
import { VendorMockRecordService } from './vendorMockRecord.service'

@Module({
  providers: [VendorMockRecordService],
  exports: [VendorMockRecordService],
})
export class VendorMocksModule {}
