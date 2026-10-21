import { Module } from '@nestjs/common'
import { GeoapifyMockController } from './geoapify/geoapifyMock.controller'
import { CallhubMockController } from './callhub/callhubMock.controller'
import { PeerlyP2pMockController } from './peerly/peerlyP2pMock.controller'
import { Peerly10DlcMockController } from './peerly/peerly10DlcMock.controller'
import { VercelMockController } from './vercel/vercelMock.controller'
import { Route53MockController } from './route53/route53Mock.controller'
import { VendorMockRecordService } from './vendorMockRecord.service'

@Module({
  controllers: [
    GeoapifyMockController,
    CallhubMockController,
    PeerlyP2pMockController,
    Peerly10DlcMockController,
    VercelMockController,
    Route53MockController,
  ],
  providers: [VendorMockRecordService],
  exports: [VendorMockRecordService],
})
export class VendorMocksModule {}
