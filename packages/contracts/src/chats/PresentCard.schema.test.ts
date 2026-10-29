import { describe, expect, it } from 'vitest'
import {
  LEGACY_PRESENT_CARD_TOOLS,
  PRESENT_CARD_DESCRIPTIONS,
  PresentCardInputSchema,
  PresentCardSchema,
  isLegacyPresentCardTool,
  pickPresentCardOptions,
} from './PresentCard.schema'

describe('PresentCardSchema', () => {
  it('describes every field of every kind, for the prompt gp-api writes from it', () => {
    for (const option of PresentCardSchema.options) {
      const kind = option.shape.kind.value
      expect(PRESENT_CARD_DESCRIPTIONS[kind]).toBeTruthy()
      for (const [field, schema] of Object.entries(option.shape)) {
        if (field === 'kind') continue
        expect(schema.description, `${kind}.${field}`).toBeTruthy()
      }
    }
  })

  it('parses a card under the input key, by kind', () => {
    const parsed = PresentCardInputSchema.parse({
      card: { kind: 'list_map', listId: 12, name: 'Renters near Main' },
    })

    expect(parsed.card).toEqual({
      kind: 'list_map',
      listId: 12,
      name: 'Renters near Main',
    })
  })

  it('rejects a kind the catalog does not have', () => {
    expect(
      PresentCardInputSchema.safeParse({
        card: { kind: 'outreach_proposal', audience: 'Renters' },
      }).success,
    ).toBe(false)
  })
})

describe('pickPresentCardOptions', () => {
  it('keeps only the kinds a surface offers, in catalog order', () => {
    const kinds = pickPresentCardOptions(['list_map', 'outside_contact']).map(
      (option) => option.shape.kind.value,
    )

    expect(kinds).toEqual(['outside_contact', 'list_map'])
  })
})

describe('LEGACY_PRESENT_CARD_TOOLS', () => {
  it('parses old args as their kind', () => {
    const parsed = PresentCardSchema.parse({
      kind: LEGACY_PRESENT_CARD_TOOLS.present_past_outreach,
      outreachIds: [4],
      note: 'The last text on parking drew the most replies.',
    })

    expect(parsed.kind).toBe('past_outreach')
  })

  it('knows the old tool names and nothing inherited', () => {
    expect(isLegacyPresentCardTool('show_list_map')).toBe(true)
    expect(isLegacyPresentCardTool('present_card')).toBe(false)
    expect(isLegacyPresentCardTool('toString')).toBe(false)
  })
})
