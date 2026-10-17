import { Module } from '@nestjs/common'
import { GeoapifyMockController } from './geoapify/geoapifyMock.controller'
import { VendorMockRecordService } from './vendorMockRecord.service'

@Module({
  controllers: [GeoapifyMockController],
  providers: [VendorMockRecordService],
  exports: [VendorMockRecordService],
})
export class VendorMocksModule {}
