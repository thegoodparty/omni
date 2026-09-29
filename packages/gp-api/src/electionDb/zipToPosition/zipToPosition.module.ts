import { Module } from '@nestjs/common'
import { ZipToPositionService } from './zipToPosition.service'

@Module({
  providers: [ZipToPositionService],
  exports: [ZipToPositionService],
})
export class ZipToPositionModule {}
