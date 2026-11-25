import { generateText } from 'ai'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  productMapReference,
  SCORING_PROMPT,
  SECOND_READ_PROMPT,
  secondReadMessage,
} from '../caseScout.prompts'
import { SecondReadCallError } from '../util/gate.util'
import { CaseScoutModelService } from './caseScoutModel.service'

vi.mock('ai', async (importOriginal) => ({
  ...(await importOriginal<typeof import('ai')>()),
  generateText: vi.fn(),
}))

const CACHED = {
  anthropic: { cacheControl: { type: 'ephemeral' } },
}

const signal = new AbortController().signal

const lastCall = () => vi.mocked(generateText).mock.calls.at(-1)?.[0]

beforeEach(() => {
  vi.mocked(generateText).mockReset()
})

describe('CaseScoutModelService', () => {
  it('scores with the scope product knowledge first, both cached', async () => {
    vi.mocked(generateText).mockResolvedValue({
      output: { session_id: 's', requests: [] },
    } as never)
    await new CaseScoutModelService().scoreTranscript(
      'chief_of_staff',
      '# session s',
      signal,
    )
    expect(lastCall()?.system).toEqual([
      {
        role: 'system',
        content: productMapReference('chief_of_staff'),
        providerOptions: CACHED,
      },
      { role: 'system', content: SCORING_PROMPT, providerOptions: CACHED },
    ])
    expect(lastCall()?.prompt).toBe('# session s')
  })

  it('drafts behind the same cached product knowledge', async () => {
    vi.mocked(generateText).mockResolvedValue({ text: '{}' } as never)
    await new CaseScoutModelService().draftCase(
      'campaign_assistant',
      'the drafting instructions',
      '# session s',
      signal,
    )
    expect(lastCall()?.system).toEqual([
      {
        role: 'system',
        content: productMapReference('campaign_assistant'),
        providerOptions: CACHED,
      },
      { role: 'system', content: 'the drafting instructions' },
    ])
  })

  it('gives the second read the draft and the real chat', async () => {
    vi.mocked(generateText).mockResolvedValue({ text: '[]' } as never)
    expect(
      await new CaseScoutModelService().secondRead(
        'the draft',
        'the real chat',
        signal,
      ),
    ).toBe('[]')
    expect(lastCall()?.system).toBe(SECOND_READ_PROMPT)
    expect(lastCall()?.prompt).toBe(
      secondReadMessage('the draft', 'the real chat'),
    )
    expect(lastCall()?.tools).toBeUndefined()
  })

  it('turns a failed second read call into a SecondReadCallError', async () => {
    vi.mocked(generateText).mockRejectedValue(new Error('overloaded'))
    await expect(
      new CaseScoutModelService().secondRead('d', 's', signal),
    ).rejects.toBeInstanceOf(SecondReadCallError)
  })
})
