import { describe, expect, it, vi } from 'vitest'
import { firstOrThrow } from 'src/shared/test-utils/arrays.util'
import { GEMINI_MODEL } from '@/vendors/google/gemini.types'
import { GeminiService } from '@/vendors/google/services/gemini.service'
import { CampaignStoryRewriteService } from './campaignStoryRewrite.service'
import { CampaignStoryService } from './campaignStory.service'

const buildSubject = (rewrite = 'A polished passage.') => {
  const generateStructured = vi.fn().mockResolvedValue({ rewrite })
  const gemini = { generateStructured } as unknown as GeminiService
  const admitRewriteAttempt = vi.fn().mockResolvedValue(true)
  const rollbackRewriteAttempt = vi.fn().mockResolvedValue(undefined)
  const story = {
    admitRewriteAttempt,
    rollbackRewriteAttempt,
  } as unknown as CampaignStoryService
  const subject = new CampaignStoryRewriteService(gemini, story)
  return {
    subject,
    generateStructured,
    admitRewriteAttempt,
    rollbackRewriteAttempt,
  }
}

describe('CampaignStoryRewriteService', () => {
  it('asks Gemini for a structured rewrite on the stable Flash model', async () => {
    const { subject, generateStructured } = buildSubject('Rewritten why.')

    const result = await subject.rewrite(
      { field: 'why', text: 'i care about schools' },
      'Jane Doe',
      5,
    )

    expect(result).toEqual({ rewrite: 'Rewritten why.' })
    const [prompt, , options] = firstOrThrow(generateStructured.mock.calls)
    expect(options.model).toBe(GEMINI_MODEL.FLASH_3_5)
    expect(prompt).toContain('Jane Doe')
    expect(prompt).toContain('i care about schools')
  })

  it('uses the field-specific guidance in the prompt', async () => {
    const { subject, generateStructured } = buildSubject()

    await subject.rewrite({ field: 'background', text: 'roads' }, 'Sam Lee', 5)

    const [prompt] = firstOrThrow(generateStructured.mock.calls)
    expect(prompt).toContain('their background')
  })

  it('rewrites an issue (Policy focus) with issue guidance + the title as context', async () => {
    const { subject, generateStructured } = buildSubject()

    await subject.rewrite(
      { field: 'issue', text: 'fix the roads', title: 'Infrastructure' },
      'Sam Lee',
      5,
    )

    const [prompt] = firstOrThrow(generateStructured.mock.calls)
    expect(prompt).toContain('concrete issues they will fight for')
    expect(prompt).toContain('Infrastructure')
  })

  it('falls back to a generic name when the candidate has none', async () => {
    const { subject, generateStructured } = buildSubject()

    await subject.rewrite({ field: 'background', text: 'grew up here' }, '', 5)

    const [prompt] = firstOrThrow(generateStructured.mock.calls)
    expect(prompt).toContain('The candidate')
  })

  it('rejects with the AI-limit error when the lifetime cap is reached', async () => {
    const { subject, generateStructured, admitRewriteAttempt } = buildSubject()
    admitRewriteAttempt.mockResolvedValue(false)

    await expect(
      subject.rewrite({ field: 'why', text: 'again' }, 'Jane Doe', 5),
    ).rejects.toThrow(/AI rewrite limit/i)
    expect(generateStructured).not.toHaveBeenCalled()
  })

  it('refunds the admitted attempt when the Gemini call fails', async () => {
    const { subject, generateStructured, rollbackRewriteAttempt } =
      buildSubject()
    generateStructured.mockRejectedValue(new Error('gemini down'))

    await expect(
      subject.rewrite({ field: 'why', text: 'again' }, 'Jane Doe', 5),
    ).rejects.toThrow('gemini down')
    expect(rollbackRewriteAttempt).toHaveBeenCalledWith(5)
  })
})
