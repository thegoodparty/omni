import { HttpModule } from '@nestjs/axios'
import { forwardRef, Module } from '@nestjs/common'
import { HttpAdapterHost } from '@nestjs/core'
import { ClerkModule } from '@/vendors/clerk/clerk.module'
import { CronModule } from '@/cron/cron.module'
import { CrmModule } from '@/crm/crmModule'
import { ContactInteractionModule } from '@/contactInteraction/contactInteraction.module'
import { ElectedOfficeModule } from '@/electedOffice/electedOffice.module'
import { LlmModule } from '@/llm/llm.module'
import { AiModule } from 'src/ai/ai.module'
import { EmailModule } from 'src/email/email.module'
import { PurchaseType } from 'src/payments/purchase.types'
import { PurchaseService } from 'src/payments/services/purchase.service'
import { AwsModule } from 'src/vendors/aws/aws.module'
import { CallhubModule } from 'src/vendors/callhub/callhub.module'
import { GoogleModule } from 'src/vendors/google/google.module'
import { SlackModule } from 'src/vendors/slack/slack.module'
import { SlackService } from 'src/vendors/slack/services/slack.service'
import { StripeModule } from 'src/vendors/stripe/stripe.module'
import { DoorKnockingModule } from '../doorKnocking/doorKnocking.module'
import { ContactsModule } from '../contacts/contacts.module'
import { OrganizationsModule } from '../organizations/organizations.module'
import { PeopleQueryModule } from '../peopleDb/peopleQuery.module'
import { PaymentsModule } from '../payments/payments.module'
import { PeerlyModule } from '../vendors/peerly/peerly.module'
import { QueueProducerModule } from '../queue/producer/queueProducer.module'
import { VotersModule } from '../voters/voters.module'
import { OutreachController } from './outreach.controller'
import { OutreachAssignmentController } from './outreachAssignment.controller'
import { OutreachSmsAdminController } from './outreachSmsAdmin.controller'
import { OutreachResultsAdminController } from './outreachResultsAdmin.controller'
import { OutreachResultsAdminService } from './services/outreachResultsAdmin.service'
import { registerResultsUploadBodyLimit } from './util/outreachResultsBodyLimit.util'
import { OutreachSmsAdminService } from './services/outreachSmsAdmin.service'
import { OutreachSmsController } from './outreachSms.controller'
import { OutreachDraftController } from './outreachDraft.controller'
import { OutreachSocialController } from './outreachSocial.controller'
import { OutreachServeSocialController } from './outreachServeSocial.controller'
import { OutreachServeSmsController } from './outreachServeSms.controller'
import { OutreachPhoneBankingController } from './outreachPhoneBanking.controller'
import { OutreachServePhoneBankingController } from './outreachServePhoneBanking.controller'
import { OutreachDoorKnockingController } from './outreachDoorKnocking.controller'
import { OutreachServeDoorKnockingController } from './outreachServeDoorKnocking.controller'
import { OutreachRobocallController } from './outreachRobocall.controller'
import { OutreachRobocallAudioController } from './outreachRobocallAudio.controller'
import { OutreachNotificationInterceptor } from './interceptors/outreachNotification.interceptor'
import { OutreachCompletionService } from './services/outreachCompletion.service'
import { OutreachInboundSweepService } from './services/outreachInboundSweep.service'
import { OutreachMaterializationService } from './services/outreachMaterialization.service'
import { OutreachAssignmentService } from './services/outreachAssignment.service'
import { OutreachService } from './services/outreach.service'
import { OutreachDraftService } from './services/outreachDraft.service'
import { OutreachDraftExpiryService } from './services/outreachDraftExpiry.service'
import { OutreachTextDeliveryService } from './services/outreachTextDelivery.service'
import {
  TEXT_DELIVERY_HANDOFF_PORT,
  type TextDeliveryHandoff,
  type TextDeliveryHandoffPort,
} from './interfaces/textDeliveryHandoff.interface'
import { sendTextDeliverySlackMessage } from './util/textDeliverySlack.util'
import { OutreachTextIngestService } from './services/outreachTextIngest.service'
import { OutreachSocialService } from './services/outreachSocial.service'
import { OutreachSocialGenerationService } from './services/outreachSocialGeneration.service'
import { OutreachPhoneBankingGenerationService } from './services/outreachPhoneBankingGeneration.service'
import { OutreachDoorKnockingGenerationService } from './services/outreachDoorKnockingGeneration.service'
import { OutreachSmsGenerationService } from './services/outreachSmsGeneration.service'
import { OutreachSmsRepliesService } from './services/outreachSmsReplies.service'
import { OutreachServeSmsCreateService } from './services/outreachServeSmsCreate.service'
import { OutreachServeSmsPurchaseHandlerService } from './services/outreachServeSmsPurchase.service'
import { OutreachRobocallGenerationService } from './services/outreachRobocallGeneration.service'
import { OutreachRobocallService } from './services/outreachRobocall.service'
import { OutreachRobocallPromoService } from './services/outreachRobocallPromo.service'
import { OutreachRobocallHoldService } from './services/outreachRobocallHold.service'
import { OutreachRobocallHoldRecoveryService } from './services/outreachRobocallHoldRecovery.service'
import { RobocallOrphanedCampaignService } from './services/robocallOrphanedCampaign.service'
import { OutreachRobocallCallhubCleanupService } from './services/outreachRobocallCallhubCleanup.service'
import { OutreachRobocallDeferredHoldService } from './services/outreachRobocallDeferredHold.service'
import { OutreachRobocallStrandedService } from './services/outreachRobocallStranded.service'
import { OutreachRobocallStagingService } from './services/outreachRobocallStaging.service'
import { OutreachRobocallSendService } from './services/outreachRobocallSend.service'
import { OutreachRobocallHoldFailureService } from './services/outreachRobocallHoldFailure.service'
import { OutreachRobocallWebhookService } from './services/outreachRobocallWebhook.service'
import { OutreachRobocallCompletionService } from './services/outreachRobocallCompletion.service'
import { OutreachRobocallCaptureService } from './services/outreachRobocallCapture.service'
import { OutreachRobocallFreshChargeService } from './services/outreachRobocallFreshCharge.service'
import { RobocallOrphanedHoldService } from './services/robocallOrphanedHold.service'
import { OutreachRobocallHoldReconcileService } from './services/outreachRobocallHoldReconcile.service'
import { RobocallTranscriptionService } from './services/robocallTranscription.service'
import { RobocallComplianceService } from './services/robocallCompliance.service'
import { RobocallComplianceResultService } from './services/robocallComplianceResult.service'
import { RobocallPhonebookService } from './services/robocallPhonebook.service'
import { OutreachComposeContextService } from './services/outreachComposeContext.service'
import { OutreachServeComposeContextService } from './services/outreachServeComposeContext.service'
import { OutreachRobocallAudioService } from './services/outreachRobocallAudio.service'
import { OutreachNotificationService } from './services/outreachNotification.service'
import { OutreachPurchaseHandlerService } from './services/outreachPurchase.service'
import { OutreachRobocallSingleSendService } from './services/outreachRobocallSingleSend.service'

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
    ElectedOfficeModule,
    ContactInteractionModule,
    CallhubModule,
    // For DoorKnockingTurfCountsService, behind the detail read's doorKnocking
    // block. forwardRef because DoorKnocking → Contacts → Campaigns → Peerly
    // loops back here, the same cycle the ContactsModule edge above defers.
    forwardRef(() => DoorKnockingModule),
    // For HubspotSingleSendService, the robocall payment/receipt single-send
    // cutover (ENG-11035).
    CrmModule,
    // For CronLockService, guarding the draft expiry job below.
    CronModule,
    // For QueueProducerService, which OutreachServeSmsPurchaseHandlerService
    // uses to enqueue `outreachTextSend` from its post-purchase step. The
    // producer module imports nothing, so this edge adds no cycle.
    QueueProducerModule,
    // For VoterQueryService, which OutreachSmsRepliesService uses to put a
    // first name on each reply. PeopleQueryModule imports only HttpModule and
    // ClerkModule, so this edge adds no cycle and needs no forwardRef.
    PeopleQueryModule,
  ],
  controllers: [
    OutreachController,
    OutreachDraftController,
    OutreachAssignmentController,
    OutreachSocialController,
    OutreachServeSocialController,
    OutreachPhoneBankingController,
    OutreachServePhoneBankingController,
    OutreachDoorKnockingController,
    OutreachServeDoorKnockingController,
    OutreachSmsController,
    // Carries BOTH Serve SMS routes: POST /v1/outreach/serve/sms/draft and
    // POST /v1/outreach/serve/sms. Neither path existed until this line.
    OutreachServeSmsController,
    OutreachRobocallController,
    OutreachRobocallAudioController,
    OutreachSmsAdminController,
    // The staff results surface: the awaiting-results queue and the per-send
    // upload that replaced fulfilment's `aws s3 cp` line, for both
    // text sends and polls.
    OutreachResultsAdminController,
  ],
  providers: [
    OutreachService,
    OutreachDraftService,
    OutreachDraftExpiryService,
    // The two delivery-layer entry points. Registered here in the contract
    // lock even though nothing injects them yet: the point of this slice is
    // that the parallel slices can inject them on day one, and an
    // @Injectable() that is never provided fails at bootstrap the moment one
    // of them declares it as a dependency.
    OutreachTextDeliveryService,
    OutreachTextIngestService,
    // Binds the delivery layer's handoff port to today's implementation:
    // post the recipient CSV to the fulfilment Slack channel for a human to
    // send. The port exists so this is the only line that changes when a real
    // vendor replaces the human step.
    //
    // Without this binding the module cannot instantiate at all —
    // OutreachTextDeliveryService takes the token as a constructor argument,
    // so an unbound token takes down every test that builds OutreachModule,
    // not just the delivery ones.
    {
      provide: TEXT_DELIVERY_HANDOFF_PORT,
      inject: [SlackService],
      useFactory: (slack: SlackService): TextDeliveryHandoffPort => ({
        send: (handoff: TextDeliveryHandoff) =>
          sendTextDeliverySlackMessage(slack.client, handoff),
      }),
    },
    OutreachSmsAdminService,
    // Depends only on OutreachTextIngestService (provided above) and Prisma,
    // so registering it cannot unbind the module. That matters: a provider
    // with an unbindable dependency takes down every suite that builds
    // OutreachModule, not just this one.
    OutreachResultsAdminService,
    OutreachSocialService,
    OutreachSocialGenerationService,
    OutreachPhoneBankingGenerationService,
    OutreachDoorKnockingGenerationService,
    OutreachSmsGenerationService,
    // The reply list behind the Serve results surface. Reads
    // poll_individual_message, the only table that stores inbound SMS text.
    OutreachSmsRepliesService,
    // The Serve SMS product layer: draft-first create, and the purchase
    // handler its checkout runs through.
    OutreachServeSmsCreateService,
    OutreachServeSmsPurchaseHandlerService,
    OutreachRobocallGenerationService,
    OutreachRobocallService,
    OutreachRobocallHoldService,
    OutreachRobocallPromoService,
    OutreachRobocallHoldRecoveryService,
    RobocallOrphanedCampaignService,
    OutreachRobocallCallhubCleanupService,
    OutreachRobocallDeferredHoldService,
    OutreachRobocallStrandedService,
    OutreachRobocallStagingService,
    OutreachRobocallSendService,
    OutreachRobocallHoldFailureService,
    OutreachRobocallWebhookService,
    OutreachRobocallCompletionService,
    OutreachRobocallCaptureService,
    OutreachRobocallFreshChargeService,
    RobocallOrphanedHoldService,
    OutreachRobocallHoldReconcileService,
    RobocallTranscriptionService,
    RobocallComplianceService,
    RobocallComplianceResultService,
    RobocallPhonebookService,
    OutreachComposeContextService,
    OutreachServeComposeContextService,
    OutreachRobocallAudioService,
    OutreachCompletionService,
    OutreachInboundSweepService,
    OutreachNotificationService,
    OutreachNotificationInterceptor,
    OutreachPurchaseHandlerService,
    OutreachMaterializationService,
    OutreachRobocallSingleSendService,
    OutreachAssignmentService,
  ],
  exports: [
    OutreachService,
    OutreachDraftService,
    OutreachPurchaseHandlerService,
    OutreachAssignmentService,
    // The queue consumer's `outreachTextSend` case calls `requestSend` on
    // this; QueueConsumerModule imports OutreachModule to reach it.
    OutreachTextDeliveryService,
  ],
})
export class OutreachModule {
  constructor(
    private readonly purchaseService: PurchaseService,
    private readonly outreachPurchaseHandler: OutreachPurchaseHandlerService,
    private readonly serveSmsPurchaseHandler: OutreachServeSmsPurchaseHandlerService,
    private readonly httpAdapterHost: HttpAdapterHost,
  ) {
    // The staff results upload takes a CSV as a string in a JSON body, and
    // Fastify's 1 MiB default would refuse a real results file with an opaque
    // 413 before the endpoint could say anything useful. This raises the limit
    // for that ONE route rather than for the whole API — see the util for why
    // it has to happen in a constructor rather than in a lifecycle hook.
    registerResultsUploadBodyLimit(this.httpAdapterHost)

    this.purchaseService.registerPurchaseHandler(
      PurchaseType.TEXT,
      this.outreachPurchaseHandler,
    )

    this.purchaseService.registerCheckoutSessionPostPurchaseHandler(
      PurchaseType.TEXT,
      (sessionId, metadata) =>
        this.outreachPurchaseHandler.executePostPurchase(sessionId, metadata),
    )

    // Serve SMS is its own PurchaseType, not a branch inside TEXT: the TEXT
    // handler prices off Peerly's leads_loaded and its post-purchase step
    // returns early unless a campaignId is present and outreachType is p2p.
    // A Serve row has neither. Registration mirrors TEXT above and POLL in
    // polls.module.ts.
    //
    // PurchaseService.getPaymentType must also map SERVE_TEXT, or checkout
    // throws out of its default branch before any of this is reached.
    this.purchaseService.registerPurchaseHandler(
      PurchaseType.SERVE_TEXT,
      this.serveSmsPurchaseHandler,
    )

    this.purchaseService.registerCheckoutSessionPostPurchaseHandler(
      PurchaseType.SERVE_TEXT,
      (sessionId, metadata) =>
        this.serveSmsPurchaseHandler.executePostPurchase(sessionId, metadata),
    )

    this.purchaseService.registerCheckoutSessionPaymentFailedHandler(
      PurchaseType.TEXT,
      (sessionId, metadata) =>
        this.outreachPurchaseHandler.executePaymentFailed(sessionId, metadata),
    )
  }
}
