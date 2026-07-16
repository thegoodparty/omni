import { Module } from '@nestjs/common'
import { ContactInteractionDoorKnockService } from './services/contactInteractionDoorKnock.service'
import { ContactInteractionRobocallService } from './services/contactInteractionRobocall.service'
import { ContactInteractionTextService } from './services/contactInteractionText.service'

@Module({
  providers: [
    ContactInteractionDoorKnockService,
    ContactInteractionTextService,
    ContactInteractionRobocallService,
  ],
  exports: [
    ContactInteractionDoorKnockService,
    ContactInteractionTextService,
    ContactInteractionRobocallService,
  ],
})
export class ContactInteractionModule {}
