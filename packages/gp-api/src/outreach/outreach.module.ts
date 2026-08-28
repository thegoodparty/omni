import { HttpModule } from '@nestjs/axios'
import { forwardRef, Module } from '@nestjs/common'
import { ClerkModule } from '@/vendors/clerk/clerk.module'
import { ContactInteractionModule } from '@/contactInteraction/contactInteraction.module'
import { LlmModule } from '@/llm/llm.module'
import { AiModule } from 'src/ai/ai.module'
import { EmailModule } from 'src/email/email.module'
import { PurchaseType } from 'src/payments/purchase.types'
import { PurchaseService } from 'src/payments/services/purchase.service'
import { AwsModule } from 'src/vendors/aws/aws.module'
import { CallhubModule } from 'src/vendors/callhub/callhub.module'
import { GoogleModule } from 'src/vendors/google/google.module'
import { SlackModule } from 'src/vendors/slack/slack.module'
import { StripeModule } from 'src/vendors/stripe/stripe.module'
import { DoorKnockingModule } from '../doorKnocking/doorKnocking.module'
import { ContactsModule } from '../contacts/contacts.module'
import { OrganizationsModule } from '../organizations/organizations.module'
import { PaymentsModule } from '../payments/payments.module'
import { PeerlyModule } from '../vendors/peerly/peerly.module'
import { VotersModule } from '../voters/voters.module'
import { OutreachController } from './outreach.controller'
import { OutreachSmsController } from './outreachSms.controller'
import { OutreachSocialController } from './outreachSocial.controller'
import { OutreachPhoneBankingController } from './outreachPhoneBanking.controller'
import { OutreachRobocallController } from './outreachRobocall.controller'
import { OutreachRobocallAudioController } from './outreachRobocallAudio.controller'
import { OutreachNotificationInterceptor } from './interceptors/outreachNotification.interceptor'
import { OutreachCompletionService } from './services/outreachCompletion.service'
import { OutreachInboundSweepService } from './services/outreachInboundSweep.service'
import { OutreachMaterializationService } from './services/outreachMaterialization.service'
import { OutreachService } from './services/outreach.service'
import { OutreachSocialService } from './services/outreachSocial.service'
import { OutreachSocialGenerationService } from './services/outreachSocialGeneration.service'
import { OutreachPhoneBankingGenerationService } from './services/outreachPhoneBankingGeneration.service'
import { OutreachSmsGenerationService } from './services/outreachSmsGeneration.service'
import { OutreachRobocallGenerationService } from './services/outreachRobocallGeneration.service'
import { OutreachRobocallService } from './services/outreachRobocall.service'
import { OutreachRobocallHoldService } from './services/outreachRobocallHold.service'
import { OutreachRobocallStagingService } from './services/outreachRobocallStaging.service'
import { OutreachRobocallSendService } from './services/outreachRobocallSend.service'
import { OutreachRobocallWebhookService } from './services/outreachRobocallWebhook.service'
import { RobocallTranscriptionService } from './services/robocallTranscription.service'
import { RobocallComplianceService } from './services/robocallCompliance.service'
import { RobocallPhonebookService } from './services/robocallPhonebook.service'
import { OutreachComposeContextService } from './services/outreachComposeContext.service'
import { OutreachRobocallAudioService } from './services/outreachRobocallAudio.service'
import { OutreachNotificationService } from './services/outreachNotification.service'
import { OutreachPurchaseHandlerService } from './services/outreachPurchase.service'

@Module({
  imports: [
    ClerkModule,
    HttpModule,
    EmailModule,
    AwsModule,
    PaymentsModule,
    forwardRef(() => PeerlyModule),
    // Outreach → Voters → Peerly → Outreach is a 3-cycle in both the file-import
    // graph and the Nest module DI graph. forwardRef defers resolution on this
    // edge so Nest can complete bootstrap.
    forwardRef(() => VotersModule),
    GoogleModule,
    AiModule,
    LlmModule,
    SlackModule,
    StripeModule,
    // ContactsModule pulls in CampaignsModule (and onward to Peerly), which
    // loops back to Outreach — defer this edge so the module graph resolves.
    forwardRef(() => ContactsModule),
    OrganizationsModule,
    ContactInteractionModule,
    CallhubModule,
    // For DoorKnockingTurfCountsService, behind the detail read's doorKnocking
    // block. forwardRef because DoorKnocking → Contacts → Campaigns → Peerly
    // loops back here, the same cycle the ContactsModule edge above defers.
    forwardRef(() => DoorKnockingModule),
  ],
  controllers: [
    OutreachController,
    OutreachSocialController,
    OutreachPhoneBankingController,
    OutreachSmsController,
    OutreachRobocallController,
    OutreachRobocallAudioController,
  ],
  providers: [
    OutreachService,
    OutreachSocialService,
    OutreachSocialGenerationService,
    OutreachPhoneBankingGenerationService,
    OutreachSmsGenerationService,
    OutreachRobocallGenerationService,
    OutreachRobocallService,
    OutreachRobocallHoldService,
    OutreachRobocallStagingService,
    OutreachRobocallSendService,
    OutreachRobocallWebhookService,
    RobocallTranscriptionService,
    RobocallComplianceService,
    RobocallPhonebookService,
    OutreachComposeContextService,
    OutreachRobocallAudioService,
    OutreachCompletionService,
    OutreachInboundSweepService,
    OutreachNotificationService,
    OutreachNotificationInterceptor,
    OutreachPurchaseHandlerService,
    OutreachMaterializationService,
  ],
  exports: [OutreachService, OutreachPurchaseHandlerService],
})
export class OutreachModule {
  constructor(
    private readonly purchaseService: PurchaseService,
    private readonly outreachPurchaseHandler: OutreachPurchaseHandlerService,
  ) {
    this.purchaseService.registerPurchaseHandler(
      PurchaseType.TEXT,
      this.outreachPurchaseHandler,
    )

    this.purchaseService.registerCheckoutSessionPostPurchaseHandler(
      PurchaseType.TEXT,
      (sessionId, metadata) =>
        this.outreachPurchaseHandler.executePostPurchase(sessionId, metadata),
    )
  }
}
