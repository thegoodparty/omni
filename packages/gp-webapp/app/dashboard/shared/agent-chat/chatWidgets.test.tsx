import { describe, expect, it } from 'vitest'
import { LEGACY_PRESENT_CARD_TOOLS } from '@goodparty_org/contracts'
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

// One present_card call per kind in the catalog.
const PRESENT_CARDS: Record<string, Record<string, unknown>> = {
  outside_contact: {
    kind: 'outside_contact',
    name: 'County engineer',
    role: 'County engineer',
    why: 'They own the culvert.',
    askFor: 'The duty engineer',
    script: 'Calling about the culvert on Mill St.',
  },
  past_outreach: {
    kind: 'past_outreach',
    outreachIds: [7],
    note: 'It landed in March.',
  },
  constituents: {
    kind: 'constituents',
    contactIds: ['c1'],
    note: 'They run the pantry.',
  },
  list_proposal: {
    kind: 'list_proposal',
    name: 'Renters',
    summary: 'Renters in the district.',
    count: 1200,
    filters: { homeownerNo: true },
  },
  list_map: { kind: 'list_map', listId: 16, name: 'Renters' },
  current_law_summary: {
    kind: 'current_law_summary',
    chapterLabel: 'Chapter 12',
    does: [{ title: 'Limits hours' }],
    gaps: [],
  },
  legislative_history: {
    kind: 'legislative_history',
    entries: [{ year: 2019, label: 'Amended', summary: 'Added a fee.' }],
  },
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

  it.each(Object.entries(PRESENT_CARDS))(
    'resolves a present_card %s card',
    (kind: string, card: Record<string, unknown>) => {
      expect(resolve('present_card', { card })?.slot).toBe(
        `present_card:${kind}`,
      )
    },
  )

  it.each(Object.entries(LEGACY_PRESENT_CARD_TOOLS))(
    'resolves the old %s as a %s card',
    (toolName: string, kind: string) => {
      expect(resolve(toolName, WIDGET_CALLS[toolName])?.slot).toBe(
        `present_card:${kind}`,
      )
    },
  )

  it('drops a present_card call whose card is not in the catalog', () => {
    expect(
      resolve('present_card', { card: { kind: 'from_a_newer_build' } }),
    ).toBeNull()
  })

  it('renders the list map and list proposal after the prose', () => {
    for (const kind of ['list_map', 'list_proposal']) {
      expect(
        resolve('present_card', { card: PRESENT_CARDS[kind] })?.placement,
      ).toBe('afterProse')
    }
    expect(
      resolve('show_list_map', WIDGET_CALLS.show_list_map)?.placement,
    ).toBe('afterProse')
    expect(
      resolve('present_card', { card: PRESENT_CARDS.outside_contact })
        ?.placement,
    ).toBe('inline')
  })

  it('renders the next-step offer under the turn', () => {
    expect(resolve('offer_next_step', {})?.placement).toBe('belowTurn')
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
