import { Module } from '@nestjs/common'
import { GeoapifyMockController } from './geoapify/geoapifyMock.controller'
import { CallhubMockController } from './callhub/callhubMock.controller'
import { VendorMockRecordService } from './vendorMockRecord.service'

@Module({
  controllers: [GeoapifyMockController, CallhubMockController],
  providers: [VendorMockRecordService],
  exports: [VendorMockRecordService],
})
export class VendorMocksModule {}
