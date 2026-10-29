import { describe, expect, it } from 'vitest'
import { chatWidgets } from './chatWidgets'

const SOURCE = { id: 's1', title: 'City code' }

// Every tool call a chat rendered as UI before the per-surface registries
// were folded into this one, with args that parse. Each must still resolve,
// so no thread that rendered a card before reloads without it.
const WIDGET_CALLS: Record<string, unknown> = {
  present_outreach_proposal: {
    audience: 'Households on the Maple Street route',
    count: 412,
    channel: 'phoneBanking',
    message: 'Calling about the repaving schedule.',
    why: 'They are the ones the closure affects.',
  },
  present_constituents: { contactIds: ['c1'], note: 'They run the pantry.' },
  present_contacts: { contactIds: ['c1'], note: 'They run the pantry.' },
  present_outside_contact: {
    name: 'County engineer',
    role: 'County engineer',
    why: 'They own the culvert.',
    askFor: 'The duty engineer',
    script: 'Calling about the culvert on Mill St.',
  },
  present_past_outreach: { outreachIds: [7], note: 'It landed in March.' },
  read_past_outreach: { outreachIds: [7], note: 'It landed in March.' },
  ask_clarify_question: {
    questionId: 'q1',
    question: 'Which first?',
    options: [{ label: 'Parking' }, { label: 'Noise' }],
  },
  compose_handoff: { channel: 'serve_social', draftText: 'A post.' },
  explain_managed_panel: { part: 'how_it_works' },
  offer_managed_panel_invite: {},
  present_managed_panel_invite: {},
  present_managed_panel: {},
  show_list_map: { listId: 16, name: 'Renters' },
  present_list_proposal: {
    name: 'Renters',
    summary: 'Renters in the district.',
    count: 1200,
    filters: { homeownerNo: true },
  },
  present_authority_finding: {
    status: 'pass',
    explanation: 'The council can do this.',
    source: SOURCE,
    headline: 'You have the authority.',
  },
  present_current_law_summary: {
    chapterLabel: 'Chapter 12',
    does: [{ title: 'Limits hours' }],
    gaps: [],
  },
  present_comparables: {
    comparables: [
      {
        city: 'Dayton',
        state: 'OH',
        quote: 'Passed in 2021.',
        status: 'passed',
        source: SOURCE,
      },
    ],
  },
  present_legislative_history: {
    entries: [{ year: 2019, label: 'Amended', summary: 'Added a fee.' }],
  },
  present_draft: { title: 'Draft', body: 'Section 1.' },
  offer_next_step: {},
  update_priority_status: { steps: [] },
}

const resolve = (toolName: string, args: unknown) =>
  chatWidgets.resolve(
    { toolName, conversationId: 'conv_1', toolCallId: 'toolu_1' },
    args,
  )

describe('chatWidgets', () => {
  it.each(Object.entries(WIDGET_CALLS))(
    'resolves %s',
    (toolName: string, args: unknown) => {
      expect(chatWidgets.has(toolName)).toBe(true)
      expect(resolve(toolName, args)?.toolName).toBe(toolName)
    },
  )

  it('resolves an unknown tool to nothing, so a newer thread still opens', () => {
    expect(chatWidgets.has('from_a_newer_build')).toBe(false)
    expect(resolve('from_a_newer_build', {})).toBeNull()
  })

  it('renders the list map and list proposal after the prose', () => {
    expect(chatWidgets.entry('show_list_map')?.placement).toBe('afterProse')
    expect(chatWidgets.entry('present_list_proposal')?.placement).toBe(
      'afterProse',
    )
  })

  it('renders the next-step offer under the turn', () => {
    expect(chatWidgets.entry('offer_next_step')?.placement).toBe('belowTurn')
  })

  it('keeps the tools that are only sometimes a card as pills when unparsed', () => {
    expect(chatWidgets.entry('read_past_outreach')?.onParseFailure).toBe(
      'inline',
    )
    expect(chatWidgets.entry('explain_managed_panel')?.onParseFailure).toBe(
      'inline',
    )
  })
})
