import { describe, expect, it } from 'vitest'
import { getSchema } from '@tiptap/core'
import { Slice } from '@tiptap/pm/model'
import { AllSelection, EditorState, type Transaction } from '@tiptap/pm/state'

import { tokenFieldExtensions } from './token-field.extensions'
import {
  docToValue,
  findViolation,
  guardTransaction,
  isInsideProtectedPhrase,
  lockedRanges,
  stripProtected,
  valueToContent,
  type ProtectedSpec,
  type TokenSpec,
} from './token-field.model'

// The field's real schema, so these run against exactly what the editor
// builds without booting a view.
const schema = getSchema(tokenFieldExtensions({ onBlocked: () => undefined }))

const FIRST_NAME: TokenSpec = {
  id: 'first_name',
  label: 'First name',
  text: '{first_name}',
  required: true,
}
// One unit, phrase and committee together: a gap between them would let a
// candidate write "Paid for by no one at Sarah Chen for Council".
const PAID_FOR_BY: ProtectedSpec = {
  id: 'paid_for_by',
  text: 'Paid for by Sarah Chen for Council',
  reason: 'Campaign finance rules require this line.',
}
const OPT_OUT: ProtectedSpec = {
  id: 'opt_out',
  text: 'Reply STOP to opt out.',
  reason: 'Every text has to offer a way to opt out.',
}

const MESSAGE =
  'Hello {first_name}, vote on Nov 3.\nPaid for by Sarah Chen for Council. Reply STOP to opt out.'

const stateFor = (
  value = MESSAGE,
  tokens: TokenSpec[] = [FIRST_NAME],
  spans: ProtectedSpec[] = [PAID_FOR_BY, OPT_OUT],
): EditorState =>
  EditorState.create({
    schema,
    doc: schema.nodeFromJSON(valueToContent(value, tokens, spans)),
  })

// Position of the first character of `needle` in the doc.
const posOf = (state: EditorState, needle: string): number => {
  let found = -1
  state.doc.descendants((node, pos) => {
    if (found !== -1 || !node.isText) return
    const index = node.text?.indexOf(needle) ?? -1
    if (index !== -1) found = pos + index
  })
  if (found === -1) throw new Error(`"${needle}" is not in the doc`)
  return found
}

const apply = (state: EditorState, tr: Transaction): string => {
  const blocked = guardTransaction(state, tr)
  if (!blocked) return docToValue(tr.doc)
  return blocked.replacement
    ? docToValue(blocked.replacement.doc)
    : docToValue(state.doc)
}

describe('valueToContent and docToValue', () => {
  it('round-trips a message with lines, tokens and protected spans', () => {
    expect(docToValue(stateFor().doc)).toBe(MESSAGE)
  })

  it('round-trips empty lines and an empty message', () => {
    expect(docToValue(stateFor('a\n\nb').doc)).toBe('a\n\nb')
    expect(docToValue(stateFor('').doc)).toBe('')
  })

  it('turns every occurrence of a token into a token node', () => {
    const state = stateFor('{first_name} and {first_name}')
    const ids: string[] = []
    state.doc.descendants((node) => {
      if (node.type.name === 'token') ids.push(String(node.attrs.id))
    })
    expect(ids).toEqual(['first_name', 'first_name'])
  })

  it('protects only the first occurrence of a span', () => {
    const state = stateFor(
      'Reply STOP to opt out. Reply STOP to opt out.',
      [],
      [OPT_OUT],
    )
    const ranges = lockedRanges(state.doc)
    expect(ranges).toHaveLength(1)
    expect(ranges[0]?.from).toBe(1)
  })

  it('locks a longer phrase even when a shorter one inside it is listed first', () => {
    const name: ProtectedSpec = {
      id: 'candidate_name',
      text: 'Sarah Chen',
      reason: 'Your name.',
    }
    const disclaimer: ProtectedSpec = {
      id: 'paid_for_by',
      text: 'Paid for by Friends of Sarah Chen',
      reason: 'Campaign finance rules.',
    }
    const state = stateFor(
      'Vote on Nov 3!\nPaid for by Friends of Sarah Chen.',
      [],
      [name, disclaimer],
    )
    expect(lockedRanges(state.doc).map((r) => r.id)).toEqual(['paid_for_by'])
  })

  it('protects nothing when the span is missing, rather than inventing it', () => {
    expect(lockedRanges(stateFor('Hi there.', [], [OPT_OUT]).doc)).toEqual([])
  })
})

describe('findViolation', () => {
  it('lets free text change', () => {
    const state = stateFor()
    const tr = state.tr.insertText('Please ', posOf(state, 'vote'))
    expect(findViolation(state.doc, tr.doc)).toBeNull()
  })

  it('flags a protected span that lost a character', () => {
    const state = stateFor()
    const at = posOf(state, 'STOP')
    const tr = state.tr.delete(at, at + 1)
    expect(findViolation(state.doc, tr.doc)).toBe('opt_out')
  })

  it('flags a required token that was deleted, but not one that moved', () => {
    const state = stateFor('{first_name} hi')
    const deleted = state.tr.delete(1, 2)
    expect(findViolation(state.doc, deleted.doc)).toBe('first_name')
    const token = state.doc.nodeAt(1)
    if (!token) throw new Error('no token')
    const moved = state.tr.delete(1, 2).insert(4, token)
    expect(findViolation(state.doc, moved.doc)).toBeNull()
  })

  it('flags a token dropped inside a protected span, which splits it', () => {
    const state = stateFor(
      '{first_name}, this is Sarah Chen.',
      [FIRST_NAME],
      [{ id: 'candidate_name', text: 'Sarah Chen', reason: 'Your name.' }],
    )
    const token = state.doc.nodeAt(1)
    if (!token) throw new Error('no token')
    const inside = posOf(state, 'Chen')
    const moved = state.tr.insert(inside, token).delete(1, 2)
    expect(docToValue(moved.doc)).toBe(', this is Sarah {first_name}Chen.')
    expect(findViolation(state.doc, moved.doc)).toBe('candidate_name')
    expect(guardTransaction(state, moved)).toEqual({
      id: 'candidate_name',
      replacement: null,
    })
  })

  it('lets an extra copy of a required token go, but never the last one', () => {
    const state = stateFor('{first_name} {first_name} hi')
    const oneLeft = state.tr.delete(1, 2)
    expect(findViolation(state.doc, oneLeft.doc)).toBeNull()
    const noneLeft = state.tr.delete(3, 4).delete(1, 2)
    expect(findViolation(state.doc, noneLeft.doc)).toBe('first_name')
  })

  it('lets an optional token be deleted', () => {
    const optional = { ...FIRST_NAME, required: false }
    const state = stateFor('{first_name} hi', [optional], [])
    expect(findViolation(state.doc, state.tr.delete(1, 2).doc)).toBeNull()
  })
})

describe('guardTransaction', () => {
  it('lets ordinary typing through untouched', () => {
    const state = stateFor()
    const tr = state.tr.insertText('Please ', posOf(state, 'vote'))
    expect(guardTransaction(state, tr)).toBeNull()
  })

  it('blocks typing inside a protected span outright', () => {
    const state = stateFor()
    const tr = state.tr.insertText('x', posOf(state, 'STOP') + 1)
    expect(guardTransaction(state, tr)).toEqual({
      id: 'opt_out',
      replacement: null,
    })
  })

  it('lets typing at the edge of a span stay outside it', () => {
    const state = stateFor()
    const end = posOf(state, 'opt out.') + 'opt out.'.length
    const tr = state.tr.insertText(' Thanks!', end)
    expect(guardTransaction(state, tr)).toBeNull()
    expect(docToValue(tr.doc)).toBe(`${MESSAGE} Thanks!`)
  })

  it('blocks a backspace into a span with nothing to salvage', () => {
    const state = stateFor()
    const end = posOf(state, 'Paid for by') + PAID_FOR_BY.text.length
    const blocked = guardTransaction(state, state.tr.delete(end - 1, end))
    expect(blocked).toEqual({ id: 'paid_for_by', replacement: null })
  })

  it('keeps the locked parts in place, spaced and on their lines, when everything is replaced', () => {
    const state = stateFor()
    const tr = state.tr
      .setSelection(new AllSelection(state.doc))
      .insertText('New text.')
    expect(apply(state, tr)).toBe(
      'New text. {first_name}\nPaid for by Sarah Chen for Council Reply STOP to opt out.',
    )
  })

  it('spaces new text away from a locked part it lands right after', () => {
    const state = stateFor(
      '{first_name}, see you Tuesday.\nReply STOP to opt out.',
      [FIRST_NAME],
      [OPT_OUT],
    )
    const tr = state.tr
      .setSelection(new AllSelection(state.doc))
      .insertText('Vote')
    expect(apply(state, tr)).toBe('{first_name} Vote\nReply STOP to opt out.')
  })

  it('keeps a space between two locked parts when the text between them goes', () => {
    const state = stateFor()
    const from = posOf(state, 'Council') + 2
    const to = posOf(state, 'STOP')
    expect(apply(state, state.tr.delete(from, to))).toContain(
      'Paid for by Sarah Chen for Council Reply STOP to opt out.',
    )
  })

  it('deletes only the free part of a selection that runs into a span, keeping the line break', () => {
    const state = stateFor()
    const from = posOf(state, 'Nov 3.')
    const to = posOf(state, 'Paid') + 4
    expect(apply(state, state.tr.delete(from, to))).toBe(
      'Hello {first_name}, vote on \nPaid for by Sarah Chen for Council. Reply STOP to opt out.',
    )
  })

  it('never carries protection in with pasted content', () => {
    const state = stateFor()
    const start = posOf(state, 'Paid for by')
    const copied = state.doc.slice(start, start + PAID_FOR_BY.text.length)
    const stripped = stripProtected(copied)
    const tr = state.tr.replace(
      posOf(state, 'vote'),
      posOf(state, 'vote'),
      stripped,
    )
    expect(guardTransaction(state, tr)).toBeNull()
    expect(
      lockedRanges(tr.doc).filter((r) => r.id === 'paid_for_by'),
    ).toHaveLength(1)
  })

  it('blocks a paste that still carries a copied span', () => {
    const state = stateFor()
    const start = posOf(state, 'Paid for by')
    const copied: Slice = state.doc.slice(
      start,
      start + PAID_FOR_BY.text.length,
    )
    const tr = state.tr.replace(
      posOf(state, 'vote'),
      posOf(state, 'vote'),
      copied,
    )
    expect(guardTransaction(state, tr)?.id).toBe('paid_for_by')
  })

  it('stands aside for the field loading a new value', () => {
    const state = stateFor()
    const tr = state.tr
      .replaceWith(0, state.doc.content.size, stateFor('Other').doc.content)
      .setMeta('tokenFieldSkipGuard', true)
    expect(guardTransaction(state, tr)).toBeNull()
  })
})

describe('isInsideProtectedPhrase', () => {
  it('is true strictly inside a phrase and false at its edges or elsewhere', () => {
    const state = stateFor()
    const start = posOf(state, 'Reply STOP')
    const end = start + OPT_OUT.text.length
    expect(isInsideProtectedPhrase(state.doc, start + 3)).toBe(true)
    expect(isInsideProtectedPhrase(state.doc, start)).toBe(false)
    expect(isInsideProtectedPhrase(state.doc, end)).toBe(false)
    expect(isInsideProtectedPhrase(state.doc, posOf(state, 'vote'))).toBe(false)
  })

  it('is what the paragraph tells the drop cursor', () => {
    const state = stateFor()
    // The drop cursor calls the hook with the view and the pointer's
    // position; only `view.state` and `pos.pos` are read.
    const hook = schema.nodes.paragraph?.spec.disableDropCursor as (
      view: { state: EditorState },
      pos: { pos: number },
    ) => boolean
    const inside = posOf(state, 'Reply STOP') + 3
    expect(hook({ state }, { pos: inside })).toBe(true)
    expect(hook({ state }, { pos: posOf(state, 'vote') })).toBe(false)
  })
})
