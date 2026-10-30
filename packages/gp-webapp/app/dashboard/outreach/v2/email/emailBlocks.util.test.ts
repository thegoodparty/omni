import { describe, expect, it } from 'vitest'
import type { EmailBlockDraft } from '@goodparty_org/contracts'
import {
  addBlock,
  addableKinds,
  applyImprovedDraft,
  canMove,
  canRemove,
  convertBlocks,
  editorIssues,
  fillFromAiDraft,
  parseBlockError,
  starterCompose,
  switchLayout,
  withIds,
  type EmailComposeState,
} from './emailBlocks.util'

const types = (state: { blocks: { block: EmailBlockDraft }[] }) =>
  state.blocks.map(({ block }) =>
    block.type === 'heading' ? `h${block.level}` : block.type,
  )

const texts = (state: { blocks: { block: EmailBlockDraft }[] }) =>
  state.blocks.flatMap(({ block }) =>
    block.type === 'heading' || block.type === 'paragraph' ? [block.text] : [],
  )

const PHOTO = 'https://assets.example.com/email-images/o/x.png'

const update: EmailComposeState = {
  layout: 'long_update',
  theme: 'classic_blue',
  subject: 'October',
  blocks: withIds([
    { type: 'heading', text: 'Ward 2 update', level: 1 },
    { type: 'image', url: PHOTO, alt: 'The park' },
    { type: 'paragraph', text: 'Dear neighbor,' },
    { type: 'heading', text: 'The vote', level: 2 },
    { type: 'paragraph', text: 'It moved to December.' },
    { type: 'divider' },
    { type: 'paragraph', text: 'Thank you, Renee' },
    { type: 'button', label: 'Read the plan', url: 'https://example.com' },
  ]),
}

describe('adding, moving and removing within the rules', () => {
  it('offers only the blocks the layout allows', () => {
    const letter = starterCompose('personal_letter')
    expect(addableKinds('personal_letter', letter.blocks)).toEqual([
      'paragraph',
      'image',
      'button',
    ])
    const cta = starterCompose('short_cta')
    // One headline, one photo and one button already; two paragraphs max.
    expect(addableKinds('short_cta', cta.blocks)).toEqual(['paragraph'])
    const two = addBlock('short_cta', cta.blocks, 'paragraph')
    expect(addableKinds('short_cta', two)).toEqual([])
  })

  it('puts a new block where the layout wants it', () => {
    const cta = starterCompose('short_cta')
    expect(
      types({ blocks: addBlock('short_cta', cta.blocks, 'paragraph') }),
    ).toEqual(['image', 'h1', 'paragraph', 'paragraph', 'button'])
    const longStart = starterCompose('long_update')
    expect(
      types({ blocks: addBlock('long_update', longStart.blocks, 'image') }),
    ).toEqual(['h1', 'image', 'paragraph', 'h2', 'paragraph'])
  })

  it('refuses a move or removal that breaks a rule', () => {
    const cta = starterCompose('short_cta')
    expect(canMove('short_cta', cta.blocks, 3, -1)).toBe(false)
    expect(canRemove('short_cta', cta.blocks, 3)).toBe(false)
    expect(canRemove('short_cta', cta.blocks, 0)).toBe(true)
    expect(canMove('long_update', update.blocks, 0, 1)).toBe(false)
    expect(canMove('long_update', update.blocks, 4, 1)).toBe(true)
    expect(canMove('long_update', update.blocks, 7, 1)).toBe(false)
  })
})

describe('switching layouts', () => {
  it('keeps every word and says what it dropped', () => {
    const { state, changes } = switchLayout(update, 'personal_letter')
    expect(types(state)).toEqual([
      'image',
      'paragraph',
      'paragraph',
      'paragraph',
      'paragraph',
      'paragraph',
      'button',
    ])
    expect(texts(state)).toEqual(texts(update))
    expect(changes.join(' ')).toContain('1 divider')
    expect(changes.join(' ')).toContain('headings are now paragraphs')
    expect(state.theme).toBe('cream_and_forest')
  })

  it('fits a long update into short with a button', () => {
    const { state } = switchLayout(update, 'short_cta')
    expect(types(state)).toEqual([
      'image',
      'h1',
      'paragraph',
      'paragraph',
      'button',
    ])
    expect(texts(state).join('\n\n')).toBe(
      'Ward 2 update\n\nDear neighbor,\n\nThe vote\n\nIt moved to December.\n\nThank you, Renee',
    )
    expect(editorIssues(state, false).email).toEqual([])
  })

  it('moves a mid-letter photo to a place the layout allows', () => {
    const letter = withIds([
      { type: 'paragraph', text: 'Hi' },
      { type: 'image', url: PHOTO, alt: 'Me' },
      { type: 'paragraph', text: 'Bye' },
    ])
    const { blocks } = convertBlocks(letter, 'long_update')
    expect(types({ blocks })).toEqual(['h1', 'image', 'paragraph', 'paragraph'])
  })

  it('takes the starter blocks when nothing is written', () => {
    const { state, changes } = switchLayout(
      starterCompose('personal_letter'),
      'short_cta',
    )
    expect(types(state)).toEqual(['image', 'h1', 'paragraph', 'button'])
    expect(changes).toEqual([])
  })
})

describe('editorIssues', () => {
  it('shows plain errors next to the block', () => {
    const state: EmailComposeState = {
      ...starterCompose('personal_letter'),
      subject: 'Hi',
      blocks: withIds([
        { type: 'paragraph', text: 'One' },
        { type: 'image', url: PHOTO, alt: 'Me' },
        { type: 'paragraph', text: 'Two' },
        { type: 'button', label: 'Go', url: 'http://example.com' },
      ]),
    }
    const issues = editorIssues(state, false)
    expect(issues.blocks[1]).toEqual([
      'This layout allows one photo, at the start or the end.',
    ])
    expect(issues.blocks[3]).toEqual(['Links must start with https://.'])
  })

  it('asks for missing pieces only when checking to send', () => {
    const cta = { ...starterCompose('short_cta'), subject: '' }
    const blocks = cta.blocks.filter(({ block }) => block.type !== 'button')
    const draft = editorIssues({ ...cta, blocks }, false)
    expect(draft.email).toEqual([])
    const final = editorIssues({ ...cta, blocks }, true)
    expect(final.email).toContain('Add a button at the end.')
    expect(final.subject).toBe('Add a subject line.')
    expect(final.blocks[0]).toEqual(['Upload a photo, or remove this block.'])
  })
})

describe('the AI draft', () => {
  it('fills the layout the user has now and keeps their photo and link', () => {
    const cta: EmailComposeState = {
      ...starterCompose('short_cta'),
      blocks: withIds([
        { type: 'image', url: PHOTO, alt: '' },
        { type: 'heading', text: '', level: 1 },
        { type: 'paragraph', text: '' },
        { type: 'button', label: '', url: 'https://example.com/rsvp' },
      ]),
    }
    const next = fillFromAiDraft(cta, {
      layout: 'short_cta',
      theme: 'bold_red',
      subject: 'Come Saturday',
      blocks: [
        { type: 'heading', text: 'Knock doors', level: 1 },
        { type: 'paragraph', text: 'Two hours.' },
        { type: 'button', label: 'Sign up', url: '' },
      ],
    })
    expect(next.subject).toBe('Come Saturday')
    expect(next.blocks.map(({ block }) => block)).toEqual([
      { type: 'image', url: PHOTO, alt: '' },
      { type: 'heading', text: 'Knock doors', level: 1 },
      { type: 'paragraph', text: 'Two hours.' },
      { type: 'button', label: 'Sign up', url: 'https://example.com/rsvp' },
    ])
  })

  it('puts improved text back in place around the rest', () => {
    const next = applyImprovedDraft(update, {
      subject: 'Your October update',
      headline: 'Ward 2, in October',
      body: 'Hello neighbor,\n\nThe vote is in December.\n\nThanks, Renee',
      buttonLabel: 'Read my plan',
    })
    expect(next.subject).toBe('Your October update')
    expect(texts(next)).toEqual([
      'Ward 2, in October',
      'Hello neighbor,',
      'The vote',
      'The vote is in December.',
      'Thanks, Renee',
    ])
    expect(types(next)).toEqual(types(update))
  })
})

describe('parseBlockError', () => {
  it('names the card a refused send points at', () => {
    expect(
      parseBlockError(
        'Finish the email before sending it. Block 4: Links must start with https://',
      ),
    ).toEqual({ index: 3, message: 'Links must start with https://.' })
    expect(parseBlockError('Something went wrong. Try again.')).toBeNull()
  })
})
