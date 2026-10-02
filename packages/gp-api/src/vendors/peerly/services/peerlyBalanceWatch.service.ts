import { Injectable } from '@nestjs/common'
import { Cron } from '@nestjs/schedule'
import { PinoLogger } from 'nestjs-pino'
import { CronLockService } from '@/cron/services/cronLock.service'
import { SlackChannel, SlackMessageType } from '../../slack/slackService.types'
import { SlackService } from '../../slack/services/slack.service'
import { PeerlyAccountService } from './peerlyAccount.service'

// Hourly, off the hour so it does not pile onto the other Peerly crons.
const PEERLY_BALANCE_WATCH_CRON = '17 * * * *'
export const PEERLY_BALANCE_WATCH_CRON_JOB = 'peerlyBalanceWatch'

// At or below zero, Peerly refuses a CampaignVerify submission outright: the
// submission fee is charged up front, unlike message sending, where Peerly
// extends credit up to creditLimit and nothing visible happens. That asymmetry
// is why a negative balance was believed harmless — on 2026-10-02 the account
// ran dry at 15:20Z, every candidate's 10DLC registration was refused from
// then on, and the first anyone knew was a page about gateway errors two hours
// later (incident 103). Warning at zero puts the cause in front of staff
// before a candidate is blocked by it.
export const PEERLY_BALANCE_FLOOR = 0

@Injectable()
export class PeerlyBalanceWatchService {
  constructor(
    private readonly logger: PinoLogger,
    private readonly peerlyAccountService: PeerlyAccountService,
    private readonly slackService: SlackService,
    private readonly cronLock: CronLockService,
  ) {}

  @Cron(PEERLY_BALANCE_WATCH_CRON, { name: PEERLY_BALANCE_WATCH_CRON_JOB })
  async checkBalance() {
    // Prod only: dev/qa point at a stubbed Peerly, so there is no real account
    // to read and nothing worth alerting on (mirrors the CV status scan).
    if (process.env.OTEL_SERVICE_ENVIRONMENT !== 'prod') {
      return
    }
    // Prod runs two replicas and both fire this @Cron; the hourly claim keeps
    // it to one vendor read and, more importantly, one Slack warning per hour.
    const now = new Date()
    const claimed = await this.cronLock.tryClaimHourlyRun(
      PEERLY_BALANCE_WATCH_CRON_JOB,
      now,
    )
    if (!claimed) return

    try {
      const { balance, creditLimit } =
        await this.peerlyAccountService.getBalance()
      if (balance > PEERLY_BALANCE_FLOOR) {
        this.logger.info(
          { balance, creditLimit },
          '[Peerly balance] Account balance is positive',
        )
        return
      }
      this.logger.error(
        { balance, creditLimit },
        '[Peerly balance] Account balance cannot cover CampaignVerify ' +
          'submissions — new 10DLC registrations will be refused',
      )
      await this.alertLowBalance(balance, creditLimit)
    } catch (err) {
      // A failed balance read is not itself a billing problem; log it and let
      // the next hour try again rather than alerting staff about our own call.
      this.logger.error(
        { err },
        '[Peerly balance] Failed to read the Peerly account balance',
      )
    } finally {
      // Seal the claim even on failure, so a thrown read does not leave the
      // slot claimed-but-incomplete for the rest of the hour.
      await this.cronLock.markHourlyCompleted(
        PEERLY_BALANCE_WATCH_CRON_JOB,
        now,
      )
    }
  }

  private async alertLowBalance(
    balance: number,
    creditLimit: number,
  ): Promise<void> {
    const blocks = [
      {
        type: SlackMessageType.HEADER,
        text: {
          type: SlackMessageType.PLAIN_TEXT,
          text: '💳 Peerly balance is out of funds for CampaignVerify',
          emoji: true,
        },
      },
      {
        type: SlackMessageType.SECTION,
        text: {
          type: SlackMessageType.MRKDWN,
          text:
            `The Peerly account balance is *${balance}* (credit limit ` +
            `${creditLimit}). CampaignVerify charges its submission fee up ` +
            'front, so Peerly will refuse new 10DLC registrations with ' +
            '"Insufficient balance to submit CV" until the account is ' +
            'topped up. Texting sends are unaffected — Peerly extends ' +
            'credit on those, which is why this does not show up anywhere ' +
            'else.',
        },
      },
    ]
    await this.slackService.message({ blocks }, SlackChannel.bot10DlcCompliance)
  }
}
