import { describe, expect, it } from 'vitest'
import { parsePriorityStatus } from '@goodparty_org/contracts'
import {
  checkPanelPart,
  checkProposalRefusal,
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
