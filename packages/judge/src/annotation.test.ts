import { describe, expect, it } from 'vitest'
import {
  excerpt,
  redactSecrets,
  REDACTED,
  renderValue,
  summarizePrompt,
} from './annotation'

// A test report is as public as the repository, so nothing an annotation
// carries may be a live credential. These are the shapes a test user's token,
// a Clerk key, a model key and a Vercel bypass secret arrive in.
const SECRETS = [
  'sk-ant-api03-abcdefghijklmnopqrstuvwxyz',
  'sk_test_abcdefghijklmnopqrstuvwxyz',
  'mt_abcdefghijklmnopqrstuvwxyz',
  'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.c2lnbmF0dXJlLXZhbHVl',
  'a1b2c3d4e5f60718293a4b5c6d7e8f90',
]

describe('redactSecrets', () => {
  it('replaces every token-shaped string it is handed', () => {
    for (const secret of SECRETS) {
      const redacted = redactSecrets(`before ${secret} after`)
      expect(redacted).toBe(`before ${REDACTED} after`)
      expect(redacted).not.toContain(secret)
    }
  })

  it('leaves ordinary text, and the fictional values a case is written in, alone', () => {
    const text =
      'Ada Lovelace called 555-0100 from ada@example.com about 12 Maple Street.'
    expect(redactSecrets(text)).toBe(text)
  })
})

describe('excerpt', () => {
  it('keeps a short value whole and cuts a long one, saying how much it cut', () => {
    expect(excerpt('short', 10)).toBe('short')
    expect(excerpt('x'.repeat(20), 10)).toBe(
      `${'x'.repeat(10)}\n… 10 more characters`,
    )
  })
})

describe('summarizePrompt', () => {
  it('collapses a prompt to one line within the limit', () => {
    const summary = summarizePrompt(`line one\n\nline  two${' x'.repeat(500)}`)
    expect(summary).not.toContain('\n')
    expect(summary.length).toBeLessThanOrEqual(301)
    expect(summary.endsWith('…')).toBe(true)
  })
})

describe('renderValue', () => {
  it('prints a string as itself and anything else as JSON', () => {
    expect(renderValue('plain')).toBe('plain')
    expect(renderValue({ passed: true })).toBe('{\n  "passed": true\n}')
  })
})
