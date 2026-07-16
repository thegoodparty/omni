import { Module } from '@nestjs/common'
import { ContactInteractionDoorKnockService } from './services/contactInteractionDoorKnock.service'
import { ContactInteractionRobocallService } from './services/contactInteractionRobocall.service'
import { ContactInteractionTextService } from './services/contactInteractionText.service'
import { SupportStatusService } from './services/supportStatus.service'

@Module({
  providers: [
    ContactInteractionDoorKnockService,
    ContactInteractionTextService,
    ContactInteractionRobocallService,
    SupportStatusService,
  ],
  exports: [
    ContactInteractionDoorKnockService,
    ContactInteractionTextService,
    ContactInteractionRobocallService,
    SupportStatusService,
  ],
})
export class ContactInteractionModule {}
