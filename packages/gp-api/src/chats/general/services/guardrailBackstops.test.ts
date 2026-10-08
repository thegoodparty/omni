import { describe, expect, it } from 'vitest'
import type { TurnToolEvent } from '@/chats/services/chatStream.service'
import {
  composeAppendix,
  handoffDraftBackstop,
  hasCautionLine,
  legalAdviceBackstop,
  smallCountBackstop,
} from './guardrailBackstops'
import { guardrailLine } from './guardrailLines'

const LEGAL = guardrailLine('legal_advice', 'chief_of_staff')
const PROFESSIONAL = guardrailLine('professional_advice', 'chief_of_staff')
const SMALL_COUNT = guardrailLine('small_count', 'chief_of_staff')
const HANDOFF = guardrailLine('handoff_draft', 'chief_of_staff')

const returned = (
  name: string,
  result: unknown,
  toolCallId = 'call-1',
): TurnToolEvent => ({
  toolCallId,
  name,
  args: {},
  status: 'returned',
  result,
})
const failed = (name: string, toolCallId = 'call-1'): TurnToolEvent => ({
  toolCallId,
  name,
  args: {},
  status: 'failed',
  error: 'boom',
})
const open = (name: string, toolCallId = 'call-1'): TurnToolEvent => ({
  toolCallId,
  name,
  args: {},
  status: 'open',
})
const unpaired = (name: string, result: unknown): TurnToolEvent => ({
  toolCallId: 'stray',
  name,
  status: 'unpaired',
  result,
})

describe('legalAdviceBackstop', () => {
  it('appends the legal line on a statute citation with no caution', () => {
    expect(
      legalAdviceBackstop(
        'Under RCW 42.56.070 the record is disclosable on request.',
        'chief_of_staff',
      ),
    ).toBe(LEGAL)
  })

  it.each([
    ['ordinary prose', 'Turnout was about 65% last cycle.'],
    ['a decline', guardrailLine('scope_decline', 'chief_of_staff')],
    ['whitespace', '   '],
  ])('stays quiet on %s', (_label, text) => {
    expect(legalAdviceBackstop(text, 'chief_of_staff')).toBeNull()
  })

  it('does not double a line the model wrote with odd spacing and non-breaking spaces', () => {
    const reply = `See § 5.12.030.\n${LEGAL.replace(/ /g, ' ').replace('Confirm', ' Confirm ')}`
    expect(legalAdviceBackstop(reply, 'chief_of_staff')).toBeNull()
  })

  it('never stacks a second caution on a professional line already present', () => {
    expect(
      legalAdviceBackstop(`See § 5.12.030. ${PROFESSIONAL}`, 'chief_of_staff'),
    ).toBeNull()
    expect(
      legalAdviceBackstop(
        'RCW 42.56 applies. This is not a substitute for professional advice.',
        'chief_of_staff',
      ),
    ).toBeNull()
  })

  it('resolves the line for the chat it is given', () => {
    expect(legalAdviceBackstop('See § 5.12.030.', 'campaign_assistant')).toBe(
      guardrailLine('legal_advice', 'campaign_assistant'),
    )
  })
})

describe('hasCautionLine', () => {
  it.each([
    ['the legal line', `x ${LEGAL}`, true],
    ['the professional line', `x ${PROFESSIONAL}`, true],
    ['a coarse caution phrasing', 'Seek legal advice first.', true],
    ['incidental prose', 'Ask a colleague.', false],
  ])('sees %s', (_label, text, expected) => {
    expect(hasCautionLine(text, 'chief_of_staff')).toBe(expected)
  })
})

describe('smallCountBackstop', () => {
  it('appends when a returned tool result reports suppressed rows', () => {
    expect(
      smallCountBackstop('Here are the counts.', 'chief_of_staff', [
        returned('query_constituent_data', { rows: [], rowsSuppressed: 2 }),
      ]),
    ).toBe(SMALL_COUNT)
  })

  it.each([
    [
      'zero suppressed',
      [returned('query_constituent_data', { rowsSuppressed: 0 })],
    ],
    ['no field', [returned('query_constituent_data', { rows: [] })]],
    [
      'a string count',
      [returned('query_constituent_data', { rowsSuppressed: '2' })],
    ],
    [
      'a null count',
      [returned('query_constituent_data', { rowsSuppressed: null })],
    ],
    ['a non-object result', [returned('query_constituent_data', 'nope')]],
    ['a failed call', [failed('query_constituent_data')]],
    ['an open call', [open('query_constituent_data')]],
    [
      'an unpaired result',
      [unpaired('query_constituent_data', { rowsSuppressed: 3 })],
    ],
    ['no events', []],
  ])('stays quiet on %s', (_label, events) => {
    expect(
      smallCountBackstop('Here are the counts.', 'chief_of_staff', events),
    ).toBeNull()
  })

  it('appends when a later call of the same tool returned after an earlier one failed', () => {
    expect(
      smallCountBackstop('Here are the counts.', 'chief_of_staff', [
        failed('query_constituent_data', 'call-1'),
        returned('query_constituent_data', { rowsSuppressed: 1 }, 'call-2'),
      ]),
    ).toBe(SMALL_COUNT)
  })

  it('does not double a line the model already wrote', () => {
    expect(
      smallCountBackstop(
        'Some groups are too small to report, so I left their counts out.',
        'chief_of_staff',
        [returned('query_constituent_data', { rowsSuppressed: 1 })],
      ),
    ).toBeNull()
  })
})

describe('handoffDraftBackstop', () => {
  it('appends when compose_handoff returned', () => {
    expect(
      handoffDraftBackstop('I opened a draft for you.', 'chief_of_staff', [
        returned('compose_handoff', { channel: 'email' }),
      ]),
    ).toBe(HANDOFF)
  })

  it.each([
    ['another tool', [returned('count_contacts', { count: 3 })]],
    ['a failed handoff', [failed('compose_handoff')]],
    ['a handoff still open', [open('compose_handoff')]],
    ['an unpaired handoff result', [unpaired('compose_handoff', {})]],
  ])('stays quiet on %s', (_label, events) => {
    expect(handoffDraftBackstop('x', 'chief_of_staff', events)).toBeNull()
  })

  it('appends when a retry of the handoff returned after the first attempt failed', () => {
    expect(
      handoffDraftBackstop('Opened.', 'chief_of_staff', [
        failed('compose_handoff', 'call-1'),
        returned('compose_handoff', { channel: 'email' }, 'call-2'),
      ]),
    ).toBe(HANDOFF)
  })

  it('does not double a line the model already wrote', () => {
    expect(
      handoffDraftBackstop(`Opened. ${HANDOFF}`, 'chief_of_staff', [
        returned('compose_handoff', {}),
      ]),
    ).toBeNull()
  })

  it('returns null for a chat that has no handoff line', () => {
    expect(
      handoffDraftBackstop('Opened.', 'campaign_assistant', [
        returned('compose_handoff', {}),
      ]),
    ).toBeNull()
  })
})

describe('composeAppendix', () => {
  it('joins the kept lines in the order given, each on its own paragraph', () => {
    expect(composeAppendix([LEGAL, null, SMALL_COUNT, HANDOFF])).toBe(
      `\n\n${LEGAL}\n\n${SMALL_COUNT}\n\n${HANDOFF}`,
    )
  })

  it('drops empty and whitespace-only entries', () => {
    expect(composeAppendix(['', '  ', LEGAL])).toBe(`\n\n${LEGAL}`)
  })

  it('returns null when nothing was kept', () => {
    expect(composeAppendix([null, '  '])).toBeNull()
    expect(composeAppendix([])).toBeNull()
  })
})
