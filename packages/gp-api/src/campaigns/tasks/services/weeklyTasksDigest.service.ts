import { Injectable } from '@nestjs/common'
import { Cron } from '@nestjs/schedule'
import { addDays } from 'date-fns'
import { PinoLogger } from 'nestjs-pino'
import { QueueProducerService } from 'src/queue/producer/queueProducer.service'
import { MessageGroup, QueueType } from 'src/queue/queue.types'
import {
  CENTRAL_TIMEZONE,
  nextMondayUtcMidnight,
} from 'src/shared/util/date.util'

@Injectable()
export class WeeklyTasksDigestService {
  constructor(
    private readonly queueService: QueueProducerService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(WeeklyTasksDigestService.name)
  }

  // Every Sunday at 11 PM Central Time
  @Cron('0 23 * * 0', {
    name: 'weeklyTasksDigest',
    timeZone: CENTRAL_TIMEZONE,
  })
  async triggerWeeklyDigest() {
    const windowStart = nextMondayUtcMidnight(new Date(), CENTRAL_TIMEZONE)
    const windowEnd = addDays(windowStart, 7)

    this.logger.info(
      { windowStart, windowEnd },
      'Triggering weekly tasks digest',
    )

    // Every ECS instance runs its own @Cron, so all of them enqueue a message
    // when this fires. We use a deterministic deduplicationId derived from
    // windowStart so SQS FIFO collapses them into a single message (within
    // the 5-minute dedup window), ensuring the handler runs once per week.
    await this.queueService.sendMessage(
      {
        type: QueueType.WEEKLY_TASKS_DIGEST,
        data: {
          windowStart: windowStart.toISOString(),
          windowEnd: windowEnd.toISOString(),
        },
      },
      MessageGroup.weeklyTasksDigest,
      {
        deduplicationId: `weeklyTasksDigest-${windowStart.toISOString()}`,
      },
    )
  }
}
