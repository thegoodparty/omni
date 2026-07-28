import { Module } from '@nestjs/common'
import { PrismaModule } from 'src/prisma/prisma.module'
import { DistrictModule } from 'src/district/district.module'
import { DoorKnockingController } from './doorKnocking.controller'
import { DoorKnockingService } from './services/doorKnocking.service'
import { DoorKnockingPackService } from './services/doorKnockingPack.service'

@Module({
  imports: [PrismaModule, DistrictModule],
  controllers: [DoorKnockingController],
  providers: [DoorKnockingService, DoorKnockingPackService],
})
export class DoorKnockingModule {}
