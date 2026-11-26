import { describe, expect, it } from 'vitest'
import {
  EMAIL_CLASSIC_THEMES,
  EMAIL_LAYOUTS,
  EMAIL_LETTER_THEMES,
  EMAIL_THEMES,
  EmailLayoutKeySchema,
  EmailThemeKeySchema,
} from './EmailTemplate.const'

describe('email template registry', () => {
  it('keeps the key schemas in step with the registries', () => {
    expect([...EmailThemeKeySchema.options].sort()).toEqual(
      Object.keys(EMAIL_THEMES).sort(),
    )
    expect([...EmailLayoutKeySchema.options].sort()).toEqual(
      Object.keys(EMAIL_LAYOUTS).sort(),
    )
  })

  it('gives every layout a default theme that exists', () => {
    for (const layout of Object.values(EMAIL_LAYOUTS)) {
      expect(EMAIL_THEMES).toHaveProperty(layout.defaultTheme)
    }
  })

  it('splits every theme between the original picker and the letter colors', () => {
    expect([...EMAIL_CLASSIC_THEMES, ...EMAIL_LETTER_THEMES].sort()).toEqual(
      Object.keys(EMAIL_THEMES).sort(),
    )
  })

  it('uses six-digit hex for every color', () => {
    for (const theme of Object.values(EMAIL_THEMES)) {
      for (const color of Object.values(theme.colors)) {
        expect(color).toMatch(/^#[0-9A-F]{6}$/)
      }
    }
  })
})
