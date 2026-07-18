import { HttpModule } from '@nestjs/axios'
import { forwardRef, Module } from '@nestjs/common'
import { JwtModule } from '@nestjs/jwt'
import { AiModule } from 'src/ai/ai.module'
import { ClerkModule } from '@/vendors/clerk/clerk.module'
import { ContactsModule } from '@/contacts/contacts.module'
import { VotersModule } from '@/voters/voters.module'
import { OrganizationsModule } from 'src/organizations/organizations.module'
import { CampaignsModule } from '../../campaigns/campaigns.module'
import { OutreachModule } from '../../outreach/outreach.module'
import { UsersModule } from '../../users/users.module'
import { GoogleModule } from '../google/google.module'
import { SlackModule } from '../slack/slack.module'
import { P2pController } from './p2p.controller'
import { P2pPhoneListUploadService } from './services/p2pPhoneListUpload.service'
import { PeerlyErrorHandlingService } from './services/peerlyErrorHandling.service'
import { PeerlyHttpService } from './services/peerlyHttp.service'
import { PeerlyIdentityService } from './services/peerlyIdentity.service'
import { PeerlyMediaService } from './services/peerlyMedia.service'
import { PeerlyP2pJobService } from './services/peerlyP2pJob.service'
import { PeerlyPhoneListCaptureService } from './services/peerlyPhoneListCapture.service'
import { PeerlyPhoneListService } from './services/peerlyPhoneList.service'
import { PeerlyScheduleService } from './services/peerlySchedule.service'

@Module({
  imports: [
    ClerkModule,
    HttpModule,
    JwtModule,
    AiModule,
    GoogleModule,
    OrganizationsModule,
    SlackModule,
    forwardRef(() => CampaignsModule),
    forwardRef(() => OutreachModule),
    forwardRef(() => ContactsModule),
    forwardRef(() => VotersModule),
    UsersModule,
  ],
  controllers: [P2pController],
  providers: [
    PeerlyErrorHandlingService,
    PeerlyHttpService,
    PeerlyIdentityService,
    PeerlyPhoneListService,
    PeerlyPhoneListCaptureService,
    PeerlyMediaService,
    PeerlyScheduleService,
    P2pPhoneListUploadService,
    PeerlyP2pJobService,
  ],
  exports: [
    PeerlyIdentityService,
    PeerlyPhoneListService,
    PeerlyMediaService,
    PeerlyP2pJobService,
  ],
})
export class PeerlyModule {}
