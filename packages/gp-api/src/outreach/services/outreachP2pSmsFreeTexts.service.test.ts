import { Test } from '@nestjs/testing'
import { PinoLogger } from 'nestjs-pino'
import { createMockLogger } from '@/shared/test-utils/mockLogger.util'
import { describe, expect, it, vi } from 'vitest'
import { PrismaService } from '@/prisma/prisma.service'
import { OutreachCreditsService } from 'src/outreachCredits/services/outreachCredits.service'
import { OutreachP2pSmsFreeTextsService } from './outreachP2pSmsFreeTexts.service'

const OUTREACH_ID = 55

const build = async (findUnique: ReturnType<typeof vi.fn>) => {
  const credits = {
    release: vi.fn().mockResolvedValue(undefined),
    refundUsed: vi.fn().mockResolvedValue(0),
  }
  const moduleRef = await Test.createTestingModule({
    providers: [
      OutreachP2pSmsFreeTextsService,
      {
        provide: PrismaService,
        useValue: { outreachP2pSms: { findUnique } },
      },
      { provide: OutreachCreditsService, useValue: credits },
      { provide: PinoLogger, useValue: createMockLogger() },
    ],
  }).compile()
  return { service: moduleRef.get(OutreachP2pSmsFreeTextsService), credits }
}

describe('OutreachP2pSmsFreeTextsService.restore', () => {
  it('releases the send reserved credit even when it redeemed no offer', async () => {
    const { service, credits } = await build(
      vi.fn().mockResolvedValue({ freeTextsApplied: false }),
    )

    await expect(service.restore(OUTREACH_ID)).resolves.toBe(false)

    expect(credits.release).toHaveBeenCalledWith(OUTREACH_ID)
    expect(credits.refundUsed).toHaveBeenCalledWith(OUTREACH_ID)
  })

  it('still releases the credit when the offer restore throws', async () => {
    const { service, credits } = await build(
      vi.fn().mockRejectedValue(new Error('db down')),
    )

    await expect(service.restore(OUTREACH_ID)).rejects.toThrow('db down')

    expect(credits.release).toHaveBeenCalledWith(OUTREACH_ID)
    expect(credits.refundUsed).toHaveBeenCalledWith(OUTREACH_ID)
  })
})
