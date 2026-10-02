import { Test, TestingModule } from '@nestjs/testing'
import { PinoLogger } from 'nestjs-pino'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CronLockService } from '@/cron/services/cronLock.service'
import { createMockLogger } from '@/shared/test-utils'
import { SlackChannel } from '../../slack/slackService.types'
import { SlackService } from '../../slack/services/slack.service'
import { PeerlyAccountService } from './peerlyAccount.service'
import {
  PEERLY_BALANCE_WATCH_CRON_JOB,
  PeerlyBalanceWatchService,
} from './peerlyBalanceWatch.service'

describe('PeerlyBalanceWatchService', () => {
  let service: PeerlyBalanceWatchService
  let getBalance: ReturnType<typeof vi.fn>
  let slackMessage: ReturnType<typeof vi.fn>
  let tryClaimHourlyRun: ReturnType<typeof vi.fn>
  let markHourlyCompleted: ReturnType<typeof vi.fn>

  beforeEach(async () => {
    getBalance = vi.fn()
    slackMessage = vi.fn().mockResolvedValue(undefined)
    tryClaimHourlyRun = vi.fn().mockResolvedValue(true)
    markHourlyCompleted = vi.fn().mockResolvedValue(undefined)

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        { provide: PeerlyAccountService, useValue: { getBalance } },
        { provide: SlackService, useValue: { message: slackMessage } },
        {
          provide: CronLockService,
          useValue: { tryClaimHourlyRun, markHourlyCompleted },
        },
        { provide: PinoLogger, useValue: createMockLogger() },
        PeerlyBalanceWatchService,
      ],
    }).compile()

    service = module.get(PeerlyBalanceWatchService)
    vi.stubEnv('OTEL_SERVICE_ENVIRONMENT', 'prod')
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  // The condition nobody could see on 2026-10-02: the account ran dry at
  // 15:20Z and the first signal was a page about gateway errors two hours
  // later, by which time four candidates were already blocked.
  it('warns the 10DLC channel when the balance can no longer cover a CV submission', async () => {
    getBalance.mockResolvedValue({ balance: -88.4, creditLimit: 1400 })

    await service.checkBalance()

    expect(slackMessage).toHaveBeenCalledTimes(1)
    const [message, channel] = slackMessage.mock.calls[0] as [
      { blocks: { text?: { text?: string } }[] },
      SlackChannel,
    ]
    expect(channel).toBe(SlackChannel.bot10DlcCompliance)
    const text = message.blocks.map((b) => b.text?.text ?? '').join('\n')
    expect(text).toContain('-88.4')
    // Staff must be able to tell from the message alone why sends look fine.
    expect(text).toContain('Insufficient balance to submit CV')
    expect(markHourlyCompleted).toHaveBeenCalledWith(
      PEERLY_BALANCE_WATCH_CRON_JOB,
      expect.any(Date),
    )
  })

  it('says nothing while the balance is healthy', async () => {
    getBalance.mockResolvedValue({ balance: 808.6, creditLimit: 100 })

    await service.checkBalance()

    expect(slackMessage).not.toHaveBeenCalled()
    expect(markHourlyCompleted).toHaveBeenCalled()
  })

  // A balance of exactly zero already refuses submissions, so it must warn.
  it('warns at exactly zero', async () => {
    getBalance.mockResolvedValue({ balance: 0, creditLimit: 0 })

    await service.checkBalance()

    expect(slackMessage).toHaveBeenCalledTimes(1)
  })

  it('does not read the vendor or alert twice when another replica holds the hour', async () => {
    tryClaimHourlyRun.mockResolvedValue(false)

    await service.checkBalance()

    expect(getBalance).not.toHaveBeenCalled()
    expect(slackMessage).not.toHaveBeenCalled()
  })

  it('does not alert staff about our own failed balance read, and releases the slot', async () => {
    getBalance.mockRejectedValue(new Error('peerly unreachable'))

    await service.checkBalance()

    expect(slackMessage).not.toHaveBeenCalled()
    expect(markHourlyCompleted).toHaveBeenCalled()
  })

  it('does nothing outside prod, where Peerly is stubbed', async () => {
    vi.stubEnv('OTEL_SERVICE_ENVIRONMENT', 'dev')

    await service.checkBalance()

    expect(tryClaimHourlyRun).not.toHaveBeenCalled()
    expect(getBalance).not.toHaveBeenCalled()
  })
})
