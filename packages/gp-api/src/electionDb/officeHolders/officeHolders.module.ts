import { Module } from '@nestjs/common'
import { OfficeHoldersService } from './officeHolders.service'

@Module({
  providers: [OfficeHoldersService],
  exports: [OfficeHoldersService],
})
export class OfficeHoldersModule {}
