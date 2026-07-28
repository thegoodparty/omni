import { Module } from '@nestjs/common'
import { OfficeHoldersController } from './officeHolders.controller'
import { OfficeHoldersService } from './officeHolders.service'

@Module({
  controllers: [OfficeHoldersController],
  providers: [OfficeHoldersService],
})
export class OfficeHoldersModule {}
