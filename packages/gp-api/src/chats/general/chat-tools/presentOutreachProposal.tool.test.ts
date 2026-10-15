import { describe, expect, it } from 'vitest'
import { parsePriorityStatus } from '@goodparty_org/contracts'
import {
  buildCampaignManagerOutreachProposalTool,
  buildChiefOfStaffOutreachProposalTool,
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
  const panelSend = {
    channel: 'text' as const,
    civicPanelAsk: true,
    panelSampleSize: 42,
    sampleSize: 84,
  }

  it('lets a panel and fresh send through', () => {
    expect(checkPanelPart(panelSend)).toBeNull()
  })

  // Its card would name who it asks and leave out who it skips.
  it('refuses a panel send that also widens an earlier sample', () => {
    expect(checkPanelPart({ ...panelSend, widensOutreachIds: [12] })).toContain(
      'not both',
    )
  })

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

describe('buildChiefOfStaffOutreachProposalTool', () => {
  it('still presents a text for Serve, which has no SMS cutoff', async () => {
    const tool = buildChiefOfStaffOutreachProposalTool({
      members: 0,
      inviteSent: false,
    })
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
