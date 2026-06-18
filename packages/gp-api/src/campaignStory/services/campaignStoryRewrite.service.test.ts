import { describe, expect, it, vi } from 'vitest'
import { GEMINI_MODEL } from '@/vendors/google/gemini.types'
import { GeminiService } from '@/vendors/google/services/gemini.service'
import { CampaignStoryRewriteService } from './campaignStoryRewrite.service'

const buildGemini = (rewrite = 'A polished passage.') => {
  const generateStructured = vi.fn().mockResolvedValue({ rewrite })
  const service = { generateStructured } as unknown as GeminiService
  return { service, generateStructured }
}

describe('CampaignStoryRewriteService', () => {
  it('asks Gemini for a structured rewrite on the stable Flash model', async () => {
    const { service, generateStructured } = buildGemini('Rewritten why.')
    const subject = new CampaignStoryRewriteService(service)

    const result = await subject.rewrite(
      { field: 'why', text: 'i care about schools' },
      'Jane Doe',
    )

    expect(result).toEqual({ rewrite: 'Rewritten why.' })
    const [prompt, , options] = generateStructured.mock.calls[0]
    expect(options.model).toBe(GEMINI_MODEL.FLASH_3_5)
    expect(prompt).toContain('Jane Doe')
    expect(prompt).toContain('i care about schools')
  })

  it('uses the field-specific guidance in the prompt', async () => {
    const { service, generateStructured } = buildGemini()
    const subject = new CampaignStoryRewriteService(service)

    await subject.rewrite({ field: 'issues', text: 'roads' }, 'Sam Lee')

    const [prompt] = generateStructured.mock.calls[0]
    expect(prompt).toContain('issues they will fight for')
  })

  it('falls back to a generic name when the candidate has none', async () => {
    const { service, generateStructured } = buildGemini()
    const subject = new CampaignStoryRewriteService(service)

    await subject.rewrite({ field: 'background', text: 'grew up here' }, '')

    const [prompt] = generateStructured.mock.calls[0]
    expect(prompt).toContain('The candidate')
  })
})
