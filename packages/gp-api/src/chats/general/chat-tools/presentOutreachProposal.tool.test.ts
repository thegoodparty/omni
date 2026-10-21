import { describe, expect, it } from 'vitest'
import { parsePriorityStatus } from '@goodparty_org/contracts'
import {
  buildCampaignManagerOutreachProposalTool,
  buildPresentOutreachProposalTool,
  checkFollowUpPart,
  checkPanelPart,
  checkProposalRefusal,
  OUTREACH_MESSAGE_RULES,
  WIN_OUTREACH_MESSAGE_RULES,
} from './presentOutreachProposal.tool'

const status = parsePriorityStatus(null)

describe('checkProposalRefusal', () => {
  it('lets a check on its gate through', () => {
    expect(
      checkProposalRefusal({ stepId: 'define', side: 'main' }, status),
    ).toBeNull()
  })

  // The model reads "Who to hear from" as the step a check is on. Naming the
  // gate in the refusal is what lets it fix the call instead of dropping the
  // link and presenting the card again unlinked.
  it('names the gate when a check is put on its listening step', () => {
    expect(
      checkProposalRefusal({ stepId: 'listen_problem', side: 'main' }, status),
    ).toContain('stepId define')
    expect(
      checkProposalRefusal({ stepId: 'listen_options', side: 'main' }, status),
    ).toContain('stepId options')
  })
})

describe('checkPanelPart', () => {
  // A text to the panel alone offers LEAVE, never the JOIN ask.
  it('refuses the join ask on a text to panel members alone', () => {
    expect(
      checkPanelPart({
        channel: 'text',
        civicPanelAsk: true,
        audienceFilters: {
          civicPanelMember: true,
          hasCellPhone: true,
          notContactedRecently: true,
        },
      }),
    ).toContain('already on the civic panel')
    expect(
      checkPanelPart({
        channel: 'text',
        audienceFilters: { civicPanelMember: true, hasCellPhone: true },
      }),
    ).toBeNull()
  })
})

describe('checkFollowUpPart', () => {
  const first = {
    channel: 'text' as const,
    sampleSize: 100,
    roundTwoSize: 100,
  }

  it('lets the first text through with the split size_round_one made', () => {
    expect(checkFollowUpPart(first)).toBeNull()
    expect(checkFollowUpPart({ ...first, roundTwoSize: 99 })).toBeNull()
  })

  it('refuses a follow-up size that is not that split', () => {
    expect(checkFollowUpPart({ ...first, roundTwoSize: 400 })).toContain(
      'size_round_one',
    )
    expect(checkFollowUpPart({ ...first, roundTwoSize: 10 })).toContain(
      'size_round_one',
    )
  })

  it('refuses a follow-up size off a text, a widen or an unsized send', () => {
    expect(checkFollowUpPart({ ...first, channel: 'phoneBanking' })).toContain(
      'text only',
    )
    expect(checkFollowUpPart({ ...first, widensOutreachIds: [4] })).toContain(
      'first text',
    )
    expect(checkFollowUpPart({ channel: 'text', roundTwoSize: 100 })).toContain(
      'first text',
    )
  })

  it('offers no other text while the follow-up is scheduled', () => {
    const read = {
      followUp: { scheduledLocalDate: '2026-11-20', texts: 120 },
    }
    expect(
      checkFollowUpPart({ channel: 'text', sampleSize: 80 }, read),
    ).toContain('already scheduled')
    expect(
      checkFollowUpPart({ channel: 'phoneBanking', sampleSize: 80 }, read),
    ).toBeNull()
  })

  it('never offers a third text once the follow-up went out', () => {
    expect(
      checkFollowUpPart({ channel: 'text' }, { followUpSent: true }),
    ).toContain('no third')
    expect(
      checkFollowUpPart({ channel: 'doorKnocking' }, { followUpSent: true }),
    ).toBeNull()
  })
})

// An official asked to be introduced by full name every time; a card that
// already names them is carried into the composer as written, so the rule
// has to ask for it here.
describe('OUTREACH_MESSAGE_RULES', () => {
  it('signs a Serve text and call script with the full name', () => {
    expect(OUTREACH_MESSAGE_RULES).toContain(
      'signed as the official by full name and office',
    )
    expect(OUTREACH_MESSAGE_RULES).toContain(
      "calling for by the official's full name and office",
    )
    expect(OUTREACH_MESSAGE_RULES).not.toContain('first name and office')
  })

  it('leaves Win phone banking on the first name', () => {
    expect(WIN_OUTREACH_MESSAGE_RULES).toContain(
      "calling for by the candidate's first name and office",
    )
  })
})

describe('buildCampaignManagerOutreachProposalTool', () => {
  const proposal = {
    audience: 'Renters on the east side',
    count: 1200,
    listName: 'East side renters',
    message: 'this is Renee Diaz, candidate for City Council. What matters?',
    deepLinkOnly: false,
  }

  it('refuses a text once texting is closed, and lets other channels through', async () => {
    const tool = buildCampaignManagerOutreachProposalTool({
      textingClosed: true,
    })
    expect(await tool.execute({ ...proposal, channel: 'text' })).toEqual({
      error: expect.stringContaining('Pick door knocking, phone banking'),
    })
    expect(
      await tool.execute({ ...proposal, channel: 'doorKnocking' }),
    ).toEqual({ presented: true, deepLinkOnly: true })
  })

  it('presents a text while texting is open', async () => {
    expect(
      await buildCampaignManagerOutreachProposalTool().execute({
        ...proposal,
        channel: 'text',
      }),
    ).toEqual({ presented: true, deepLinkOnly: true })
  })
})

describe('buildPresentOutreachProposalTool', () => {
  it('still presents a text for Serve, which has no SMS cutoff', async () => {
    const tool = buildPresentOutreachProposalTool()
    expect(
      await tool.execute({
        audience: 'Residents downtown',
        count: 800,
        listName: 'Downtown',
        message: 'this is Bryan Ortiz, your City Council Member. What matters?',
        channel: 'text',
        deepLinkOnly: false,
      }),
    ).toEqual({ presented: true, deepLinkOnly: true })
  })
})
