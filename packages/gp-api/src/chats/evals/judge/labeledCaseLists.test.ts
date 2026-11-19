import { describe, expect, it } from 'vitest'
import { requireAgent } from './agents'
import { loadCaseList, loadLabeledList } from './cases'
import { replyIntentAdapter } from './labeled/replyIntent.adapter'

// The reply_intent list, read through the real loader and run through
// today's production predicates. The count of cases the regex gets fully
// right is written into the list's note, so the note can say what main
// scores today; this is what keeps that sentence true when either the list
// or a predicate changes.
describe('the reply_intent case list', () => {
  const list = loadLabeledList(requireAgent('reply_intent'))

  it('declares the three reply labels, opt-out as the floor', () => {
    expect(list.labels).toEqual([
      { name: 'optOut', type: 'boolean', floor: true },
      { name: 'civicPanelJoin', type: 'boolean' },
      { name: 'civicPanelLeave', type: 'boolean' },
    ])
  })

  it('covers every channel and both directions of every label', () => {
    const channels = new Set(list.cases.map((one) => one.input.channel))
    expect([...channels].sort()).toEqual(['call', 'door', 'email', 'text'])
    for (const { name } of list.labels) {
      const values = new Set(list.cases.map((one) => one.expected[name]))
      expect([...values].sort(), name).toEqual([false, true])
    }
  })

  it('states the regex score it really gets', async () => {
    const fullyRight: string[] = []
    const misses: string[] = []
    for (const one of list.cases) {
      const { labels } = await replyIntentAdapter(one.input, {
        spends: false,
      })
      const right = Object.entries(one.expected).every(
        ([name, value]) => labels[name]?.value === value,
      )
      if (right) fullyRight.push(one.caseId)
      else misses.push(one.caseId)
    }
    expect(misses).toEqual([
      'quit_blowing_up_phone',
      'spanish_no_more_messages',
      'done_hearing_from_you',
      'typo_stop_txting',
      'door_no_more_visits',
      'join_intent_count_me_in',
      'join_intent_sign_me_up',
      'leave_the_panel_please',
      'leave_panel_keep_updates',
      'leave_and_stop',
    ])
    const { note } = loadCaseList(requireAgent('reply_intent'))
    expect(note).toContain(
      `gets every label right on ${fullyRight.length} of ` +
        `${list.cases.length} cases`,
    )
  })

  it('says the labels are intent, and why a keyword-only join misses', () => {
    const { note } = loadCaseList(requireAgent('reply_intent'))
    expect(note).toContain("the person's INTENT")
    expect(note).toContain('keyword-only on purpose')
    expect(note).toContain('not a compliance bug')
  })
})
