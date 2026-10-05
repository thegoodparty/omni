import { describe, expect, it } from 'vitest'
import { capToolErrorDetails, toolErrorDetail } from './toolErrorDetails'

const NO_ENV: NodeJS.ProcessEnv = {}

const messageOf = (text: string, env: NodeJS.ProcessEnv = NO_ENV): string =>
  toolErrorDetail('Bash', text, env).message

// The text lands in a stored record and then in $GITHUB_STEP_SUMMARY on a
// public repository, and a shell can print anything.
describe('toolErrorDetail redaction', () => {
  it.each([
    ['an email', 'no row for jane.doe@example.org', 'no row for [email]'],
    ['an Anthropic key', 'auth sk-ant-api03-abcdefgh', 'auth [redacted key]'],
    [
      'a Databricks token',
      'token dapi0123456789abcdef',
      'token [redacted token]',
    ],
    [
      'a bearer token',
      'header Bearer abc.def-ghi',
      'header Bearer [redacted token]',
    ],
    ['a JWT', 'got eyJhbGciOi.eyJzdWIiOi.c2lnbmF0dXJl', 'got [redacted token]'],
    ['an AWS key id', 'as AKIAABCDEFGHIJKLMNOP', 'as [redacted key]'],
    ['a key=value secret', 'api_key=hunter2hunter2', 'api_key=[redacted]'],
    ['a JSON secret', '{"password": "hunter2"}', '{"password": "[redacted]"}'],
    [
      'a long hex token',
      'sig 0123456789abcdef0123456789abcdef',
      'sig [redacted token]',
    ],
    ['a uuid', 'contact 123e4567-e89b-12d3-a456-426614174000', 'contact [id]'],
    ['a long digit run', 'voter 12345678 missing', 'voter [digits] missing'],
    [
      'a credentialed url',
      'connect postgres://u:p@host/db failed',
      'connect [redacted url] failed',
    ],
  ])('strips %s', (_, input, expected) => {
    expect(messageOf(input)).toBe(expected)
  })

  it('strips a known secret by value', () => {
    expect(
      messageOf('denied for opaque-secret-value', {
        DATABRICKS_CLIENT_SECRET: 'opaque-secret-value',
      }),
    ).toBe('denied for [redacted DATABRICKS_CLIENT_SECRET]')
  })

  it("leaves an ordinary traceback's cause alone", () => {
    expect(messageOf("Exit code 1\nKeyError: 'PARAMS_JSON'")).toBe(
      "Exit code 1\nKeyError: 'PARAMS_JSON'",
    )
  })
})

describe('toolErrorDetail bounds', () => {
  it('keeps both ends of a long message within the cap', () => {
    const message = messageOf(
      `Exit code 1\n${'y'.repeat(2000)}\nKeyError: 'PARAMS_JSON'`,
    )
    expect(message.length).toBe(300)
    expect(message.startsWith('Exit code 1')).toBe(true)
    expect(message.endsWith("KeyError: 'PARAMS_JSON'")).toBe(true)
  })

  it('redacts before it cuts, so a secret straddling the cut is gone', () => {
    const message = messageOf(`${'a '.repeat(48)}sk-ant-${'z'.repeat(400)}`)
    expect(message).not.toMatch(/z{8}/)
  })

  it('never stores an empty message or tool', () => {
    expect(toolErrorDetail(undefined, '  ', NO_ENV)).toEqual({
      tool: 'unknown',
      message: 'no error text',
    })
  })

  it('caps the list at ten', () => {
    const details = Array.from({ length: 12 }, (_, i) => ({
      tool: `t${i}`,
      message: 'boom',
    }))
    expect(capToolErrorDetails(details).map((d) => d.tool)).toEqual(
      details.slice(0, 10).map((d) => d.tool),
    )
  })
})
