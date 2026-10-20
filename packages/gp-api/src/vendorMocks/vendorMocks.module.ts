import { Module } from '@nestjs/common'
import { GeoapifyMockController } from './geoapify/geoapifyMock.controller'
import { CallhubMockController } from './callhub/callhubMock.controller'
import { PeerlyP2pMockController } from './peerly/peerlyP2pMock.controller'
import { VendorMockRecordService } from './vendorMockRecord.service'

@Module({
  controllers: [
    GeoapifyMockController,
    CallhubMockController,
    PeerlyP2pMockController,
  ],
  providers: [VendorMockRecordService],
  exports: [VendorMockRecordService],
})
export class VendorMocksModule {}
