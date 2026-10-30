import { describe, expect, it } from 'vitest'
import { PriorityThemeCommentsSchema } from './PriorityResults.schema'

describe('PriorityThemeCommentsSchema', () => {
  it('keeps the words and drops anything about who said them', () => {
    const parsed = PriorityThemeCommentsSchema.parse({
      themeId: 't-1',
      comments: [
        {
          text: 'The drain backs up.',
          kind: 'reply',
          personId: 'p-1',
          firstName: 'Ana',
          phone: '5555550100',
        },
      ],
    })

    expect(parsed).toEqual({
      themeId: 't-1',
      comments: [{ text: 'The drain backs up.', kind: 'reply' }],
    })
  })

  it('refuses a comment that is neither a reply nor a note', () => {
    expect(
      PriorityThemeCommentsSchema.safeParse({
        themeId: 't-1',
        comments: [{ text: 'Hi', kind: 'email' }],
      }).success,
    ).toBe(false)
  })
})
