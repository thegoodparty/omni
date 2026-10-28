import { PinoLogger } from 'nestjs-pino'
import { describe, expect, it, vi } from 'vitest'
import { EmailOutreachQueueService } from './emailOutreachQueue.service'
import { OutreachEmailInboundService } from './outreachEmailInbound.service'
import { OutreachEmailPrepareService } from './outreachEmailPrepare.service'

// false makes the consumer redeliver, so a failed or early message ages to
// the DLQ instead of being acked and lost.
describe('EmailOutreachQueueService', () => {
  const logger = {
    setContext: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  } as Partial<PinoLogger> as PinoLogger
  const prepare = vi.fn()
  const prepares = { prepare } as Partial<OutreachEmailPrepareService>
  const process = vi.fn()
  const inbound = { process } as Partial<OutreachEmailInboundService>
  const service = new EmailOutreachQueueService(
    logger,
    prepares as OutreachEmailPrepareService,
    inbound as OutreachEmailInboundService,
  )

  it('acks a prepared send', async () => {
    prepare.mockResolvedValueOnce(undefined)
    await expect(
      service.handleSendPrepare({ outreachEmailId: 1 }),
    ).resolves.toBe(true)
    expect(prepare).toHaveBeenCalledWith(1)
  })

  it('redelivers a prepare that failed', async () => {
    prepare.mockRejectedValueOnce(new Error('SES down'))
    await expect(
      service.handleSendPrepare({ outreachEmailId: 1 }),
    ).resolves.toBe(false)
  })

  const inboundMessage = {
    snsMessageId: 'sns-2',
    bucket: 'email-inbound-dev',
    key: 'reply-1',
  }

  it('acks a handled reply', async () => {
    process.mockResolvedValueOnce(undefined)
    await expect(service.handleInbound(inboundMessage)).resolves.toBe(true)
    expect(process).toHaveBeenCalledWith('email-inbound-dev', 'reply-1')
  })

  it('redelivers a reply that failed', async () => {
    process.mockRejectedValueOnce(new Error('S3 down'))
    await expect(service.handleInbound(inboundMessage)).resolves.toBe(false)
  })
})
