import { describe, expect, it } from 'vitest'
import { ChatCardSchema, OutreachProposalSchema } from './ChatCard.schema'
import { MAX_LIST_SAMPLE_SIZE } from '../people/ListSample.schema'

const proposal = {
  proposalKey: '1b4e28ba-2fa1-41d2-883f-0016d3cca427',
  audience: 'Renters on the flood blocks',
  count: 58_520,
  channel: 'text',
  savedFilterId: 77,
  message: 'Is flooding on your block the problem we should fix first?',
  why: 'They live with it.',
}

describe('OutreachProposalSchema', () => {
  it('still parses a card persisted before samples existed', () => {
    const parsed = ChatCardSchema.parse({
      kind: 'outreach_proposal',
      ...proposal,
    })

    expect(parsed).toMatchObject({ kind: 'outreach_proposal', count: 58_520 })
    expect(parsed).not.toHaveProperty('sampleSize')
  })

  it('carries a sample and how it was sized', () => {
    expect(
      OutreachProposalSchema.parse({
        ...proposal,
        sampleSize: 4_000,
        targetResponses: 100,
        assumedReplyRate: 0.025,
        widensOutreachIds: [12],
      }),
    ).toMatchObject({
      sampleSize: 4_000,
      targetResponses: 100,
      assumedReplyRate: 0.025,
      widensOutreachIds: [12],
    })
  })

  it('refuses a sample past what one draw can hold', () => {
    expect(
      OutreachProposalSchema.safeParse({
        ...proposal,
        sampleSize: MAX_LIST_SAMPLE_SIZE + 1,
      }).success,
    ).toBe(false)
  })

  it('refuses a reply rate written as a percent', () => {
    expect(
      OutreachProposalSchema.safeParse({ ...proposal, assumedReplyRate: 2.5 })
        .success,
    ).toBe(false)
  })
})
