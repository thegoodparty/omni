import { describe, expect, it } from 'vitest'
import {
  isReportBackMessage,
  reportBackMessage,
  ChatCardSchema,
  isToolRefusal,
  OutreachProposalSchema,
} from './ChatCard.schema'
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

  it('carries one send to the panel and a fresh sample, with the join ask', () => {
    expect(
      OutreachProposalSchema.parse({
        ...proposal,
        savedFilterId: undefined,
        audienceFilters: { hasCellPhone: true, notContactedRecently: true },
        sampleSize: 240,
        panelSampleSize: 120,
        civicPanelAsk: true,
      }),
    ).toMatchObject({
      sampleSize: 240,
      panelSampleSize: 120,
      civicPanelAsk: true,
    })
  })
})

describe('isReportBackMessage', () => {
  it("knows the app's report back turn, and only that", () => {
    expect(isReportBackMessage(reportBackMessage(77))).toBe(true)
    expect(isReportBackMessage('[Report back] what did people say?')).toBe(
      false,
    )
    expect(isReportBackMessage('[Report back] tell me about outreach:77')).toBe(
      false,
    )
  })
})

describe('isToolRefusal', () => {
  it('reads an error result as a refusal and anything else as not', () => {
    expect(isToolRefusal({ error: 'Count again.' })).toBe(true)
    expect(isToolRefusal({ presented: true })).toBe(false)
    expect(isToolRefusal({ error: { code: 1 } })).toBe(false)
    expect(isToolRefusal(null)).toBe(false)
    expect(isToolRefusal('error')).toBe(false)
  })
})
