import { describe, expect, it } from 'vitest'
import {
  excerpt,
  redactSecrets,
  REDACTED,
  redactedJson,
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
  // A Vercel bypass secret is opaque, so the pattern covers any unbroken run of
  // URL-safe characters rather than guessing a vendor's alphabet.
  it('covers a Vercel bypass secret, whose shape is not a known one', () => {
    const bypass = 'Q2xpY2tUb0J5cGFzc1RoaXNWZXJjZWxCeXBhc3NTZWNyZXQ'
    expect(redactSecrets(`x-vercel-protection-bypass: ${bypass}`)).toBe(
      `x-vercel-protection-bypass: ${REDACTED}`,
    )
  })

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

  it('keeps a run ID, so a report can name the failed run', () => {
    const text = '"runId": "b5474767-7a55-4029-8b43-e720f85e53b8"'
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

  // A cut through a secret leaves a fragment no pattern matches any more, so
  // redacting after the cut would miss exactly the case that matters.
  it('redacts before it cuts, so a secret at the limit leaves no prefix', () => {
    const secret = 'sk-ant-api03-abcdefghijklmnopqrstuvwxyz'
    const cut = excerpt(`header ${secret} trailer`, 20)
    expect(cut).not.toContain('sk-ant')
    expect(cut).not.toContain('abcdefghij')
    expect(cut).toBe('header [redacted] tr\n… 5 more characters')
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

describe('redactedJson', () => {
  // Redacting the finished JSON eats the `n` of an escaped newline, and the
  // result no longer parses, so a reader drops the whole annotation.
  it('stays valid JSON when a secret starts a line', () => {
    const secret = 'a1b2c3d4e5f60718293a4b5c6d7e8f90'
    const rendered = redactedJson({ reasoning: `first\n${secret}` })
    expect(rendered).not.toContain(secret)
    expect(JSON.parse(rendered)).toEqual({ reasoning: `first\n${REDACTED}` })
  })

  it('redacts every string it holds, at any depth', () => {
    const secret = 'sk-ant-api03-abcdefghijklmnopqrstuvwxyz'
    const rendered = redactedJson({
      orders: [{ handledWhen: { base: secret } }],
    })
    expect(rendered).not.toContain(secret)
  })

  // `annotateWith` would run the pattern again over the finished text, where the
  // `n` of a `\n` plus a 31-character word is a 32-character match and the
  // replacement leaves an invalid escape. That is why the order and decision
  // annotations go through `annotateRedacted`; what this pins is that the text
  // they hand it parses as it stands, and that the second pass would not.
  it('parses as it stands when a 31-character word starts a line', () => {
    const word = 'a'.repeat(31)
    const message = redactedJson({ reasoning: `first\n${word}` })
    expect(JSON.parse(message)).toEqual({ reasoning: `first\n${word}` })
    expect(() => JSON.parse(redactSecrets(message))).toThrow(SyntaxError)
  })
})
