import { describe, expect, it } from 'vitest'
import { CreateOutreachDraftRequestSchema } from './OutreachDraft.schema'

const KEY = '6f1c2b3a-4d5e-4f60-8a71-92b3c4d5e6f7'

const textDraft = {
  outreachType: 'p2p',
  name: 'Weekend texts',
  voterFileFilterId: '41',
  script: 'Early voting opens Saturday.',
}

describe('CreateOutreachDraftRequestSchema proposalKey', () => {
  it('takes a card key on a texting draft', () => {
    const parsed = CreateOutreachDraftRequestSchema.parse({
      ...textDraft,
      proposalKey: KEY,
    })
    expect(parsed.proposalKey).toBe(KEY)
  })

  it('leaves a hub draft keyless', () => {
    expect(
      CreateOutreachDraftRequestSchema.parse(textDraft),
    ).not.toHaveProperty('proposalKey')
  })

  it('refuses a key that is not a uuid', () => {
    const result = CreateOutreachDraftRequestSchema.safeParse({
      ...textDraft,
      proposalKey: 'not-a-key',
    })
    expect(result.success).toBe(false)
  })

  it('refuses a key on a robocall draft', () => {
    const result = CreateOutreachDraftRequestSchema.safeParse({
      outreachType: 'robocall',
      name: 'Call',
      voterFileFilterId: 41,
      audioKey: 'robocall/9/clip.webm',
      callbackNumber: '+15125550123',
      proposalKey: KEY,
    })
    expect(result.success).toBe(false)
    expect(result.error?.issues[0]?.path).toEqual(['proposalKey'])
  })
})
