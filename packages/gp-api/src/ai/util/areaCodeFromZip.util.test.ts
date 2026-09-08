import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createMockLogger } from '@/shared/test-utils/mockLogger.util'
import { LlmService } from '@/llm/services/llm.service'
import { S3Service } from '@/vendors/aws/services/s3.service'
import { AreaCodeFromZipService } from './areaCodeFromZip.util'

type MockFn = ReturnType<typeof vi.fn>

describe('AreaCodeFromZipService.getAreaCodeFromZip', () => {
  let service: AreaCodeFromZipService
  let s3: { buildKey: MockFn; getFile: MockFn; uploadFile: MockFn }
  let llm: { chatCompletion: MockFn }

  const respondWith = (content: string): void => {
    llm.chatCompletion.mockResolvedValue({ content, tokens: 10, model: 'test' })
  }

  beforeEach(() => {
    s3 = {
      buildKey: vi.fn().mockReturnValue('zip-to-area-code-mappings.json'),
      getFile: vi.fn().mockResolvedValue(undefined),
      uploadFile: vi.fn().mockResolvedValue(undefined),
    }
    llm = { chatCompletion: vi.fn() }
    service = new AreaCodeFromZipService(
      s3 as unknown as S3Service,
      llm as unknown as LlmService,
      createMockLogger(),
    )
  })

  it('parses a prose-wrapped response into the area code array', async () => {
    // The exact shape seen in prod for zip 70124: prose prefix, a markdown
    // **504**, and a trailing ["504"] array. Strict JSON.parse of the whole
    // string threw and forced a national number; extraction must recover 504.
    respondWith(
      'I need to determine the area codes for zip code 70124, which is in ' +
        'New Orleans, Louisiana.New Orleans, Louisiana uses area code ' +
        '**504**.["504"]',
    )

    expect(await service.getAreaCodeFromZip('70124')).toEqual(['504'])
  })

  it('parses a clean bare-array response', async () => {
    respondWith('["415","510"]')

    expect(await service.getAreaCodeFromZip('94110')).toEqual(['415', '510'])
  })

  it('takes the first valid array, not a trailing decoy array', async () => {
    // Answer-then-decoy: the real answer comes first, a formatting hint
    // trails it. The old last-array heuristic would have grabbed the decoy.
    respondWith('The area codes are ["907"]. (format like ["123","456"])')

    expect(await service.getAreaCodeFromZip('99501')).toEqual(['907'])
  })

  it('skips a trailing empty array and returns the real answer', async () => {
    respondWith('The area code is ["212"]. If unknown, [].')

    expect(await service.getAreaCodeFromZip('10001')).toEqual(['212'])
  })

  it('returns null when the response has no array', async () => {
    respondWith('I am not sure which area codes cover that zip code.')

    expect(await service.getAreaCodeFromZip('00000')).toBeNull()
  })

  it('returns null for an empty-array response', async () => {
    respondWith('[]')

    expect(await service.getAreaCodeFromZip('00000')).toBeNull()
  })

  it('extracts via a single chatCompletion call, not structured output', async () => {
    respondWith('["504"]')

    await service.getAreaCodeFromZip('70124')

    expect(llm.chatCompletion).toHaveBeenCalledTimes(1)
  })
})
