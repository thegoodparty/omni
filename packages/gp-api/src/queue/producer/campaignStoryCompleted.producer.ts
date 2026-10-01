import { Injectable } from '@nestjs/common'
import { PinoLogger } from 'nestjs-pino'
import { MessageGroup, QueueType } from '../queue.types'
import { QueueProducerService } from './queueProducer.service'

@Injectable()
export class CampaignStoryCompletedProducer {
  constructor(
    private readonly queue: QueueProducerService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(CampaignStoryCompletedProducer.name)
  }

  // Announce that a campaign story field was written, so the plan can be
  // regenerated once the story is actually complete. The handler decides
  // completeness; every write path just says "something changed".
  //
  // Enqueued over a direct service call because the three write paths live in
  // the campaignStory, websites and chat modules, and campaignStrategy already
  // depends on the first two — calling it from them would need a module cycle
  // at each edge. It also keeps a story autosave off the regeneration's
  // latency.
  //
  // Deduplicated per campaign so an autosave burst (the story page saves each
  // field independently) collapses to one message inside SQS FIFO's 5-minute
  // window. Safe to collapse: the handler is one-shot per campaign anyway.
  //
  // Best-effort — a story save must never fail because this could not be
  // enqueued. The plan still regenerates on the candidate's next plan read.
  async announce(campaignId: number): Promise<void> {
    try {
      await this.queue.sendMessage(
        {
          type: QueueType.CAMPAIGN_STORY_COMPLETED,
          data: { campaignId },
        },
        MessageGroup.campaignStoryCompleted,
        { deduplicationId: `campaignStoryCompleted-${campaignId}` },
      )
    } catch (err) {
      this.logger.error(
        { err, campaignId },
        'failed to enqueue campaignStoryCompleted',
      )
    }
  }
}
