import { PinoLogger } from 'nestjs-pino'
import { describe, expect, it, vi } from 'vitest'
import { EmailOutreachQueueService } from './emailOutreachQueue.service'

// false makes the consumer redeliver, so an early message ages to the DLQ
// instead of being acked and lost.
describe('EmailOutreachQueueService (not built yet)', () => {
  const logger = {
    setContext: vi.fn(),
    warn: vi.fn(),
  } as Partial<PinoLogger> as PinoLogger
  const service = new EmailOutreachQueueService(logger)

  it('never acks a list import', async () => {
    await expect(
      service.handleListImport({ listId: 1, attempt: 0, cursor: 0 }),
    ).resolves.toBe(false)
  })

  it('never acks a send prepare', async () => {
    await expect(
      service.handleSendPrepare({ outreachEmailId: 1 }),
    ).resolves.toBe(false)
  })

  it('never acks an SES event', async () => {
    await expect(
      service.handleEvent({
        snsMessageId: 'sns-1',
        sesEvent: { eventType: 'Bounce', mail: { messageId: 'ses-1' } },
      }),
    ).resolves.toBe(false)
  })

  it('never acks an inbound reply', async () => {
    await expect(
      service.handleInbound({
        snsMessageId: 'sns-2',
        bucket: 'email-inbound-dev',
        key: 'reply-1',
      }),
    ).resolves.toBe(false)
  })
})
