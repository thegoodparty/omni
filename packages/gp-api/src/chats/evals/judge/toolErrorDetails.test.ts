import { describe, expect, it } from 'vitest'
import {
  capToolErrorDetails,
  errorClass,
  publicToolName,
  toolErrorDetail,
} from './toolErrorDetails'

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
    [
      'an aws_secret_access_key',
      'aws_secret_access_key = wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
      'aws_secret_access_key = [redacted]',
    ],
    [
      'an unlabelled AWS secret',
      'got wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY back',
      'got [redacted token] back',
    ],
    [
      'basic auth',
      'Authorization: Basic QWxhZGRpbjpvcGVuIHNlc2FtZQ==',
      'Authorization: [redacted] [redacted token]',
    ],
    [
      'a basic credential',
      'sent Basic QWxhZGRpbjpvcGVu',
      'sent Basic [redacted token]',
    ],
    ['a dashed phone', 'call 555-867-5309 now', 'call [phone] now'],
    ['a bracketed phone', 'call (555) 867-5309 now', 'call [phone] now'],
    ['an SSN', 'ssn 078-05-1120 on file', 'ssn [ssn] on file'],
    [
      'an internal host',
      'could not reach warehouse.cloud.internal:8443',
      'could not reach [host]:8443',
    ],
    ['an ip', 'refused by 10.0.12.7', 'refused by [ip]'],
    ['a url', 'GET https://x.example/a?b=c failed', 'GET [url] failed'],
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

// THE PUBLIC VOCABULARY. Anything this returns can land on a public page, so
// every class is built from a captured token alone, never the message.
describe('errorClass', () => {
  it.each([
    ['Exit code 2\nsomething went wrong', 'exit code 2'],
    ["Exit code 1\nTraceback ...\nKeyError: 'PARAMS_JSON'", 'KeyError'],
    ['json.decoder.JSONDecodeError: Expecting value', 'JSONDecodeError'],
    [
      'PeopleDbxUnavailableError: credential not configured',
      'PeopleDbxUnavailableError',
    ],
    ['Traceback ...\nRuntimeWarning: overflow', 'other exception'],
    ['Traceback ...\nModuleNotFoundError: no module', 'ModuleNotFoundError'],
    ['httpx.HTTPStatusError: 502 Bad Gateway', 'HTTPStatusError'],
    ['ReferenceError: x is not defined', 'ReferenceError'],
    [
      '[TABLE_OR_VIEW_NOT_FOUND] The table cannot be found',
      'TABLE_OR_VIEW_NOT_FOUND',
    ],
    ['[DEADLINE_EXCEEDED] took too long', 'DEADLINE_EXCEEDED'],
    ['[SOME_NEW_ERROR] whatever', 'other error code'],
    [
      '[PARSE_SYNTAX_ERROR] Syntax error at or near SELECT',
      'PARSE_SYNTAX_ERROR',
    ],
    ['request failed with status 503', 'HTTP 503'],
    ['HTTP/1.1 404 Not Found', 'HTTP 404'],
    ['Command timed out after 120s', 'timeout'],
    ['something odd happened', 'other'],
    ['', 'other'],
  ])('classifies %j as %s', (message, expected) => {
    expect(errorClass(message)).toBe(expected)
  })

  it.each([
    // A name inside a KeyError is the KeyError, not the name.
    ["KeyError: 'Jane Smith, 742 Evergreen Terrace'", 'KeyError'],
    // A last line that is just data is not an exception name.
    ['Traceback ...\nJane Smith', 'other'],
    ['Jane Smith: 742 Evergreen Terrace', 'other'],
    // A number that is not beside status wording is not a status.
    ['voter 404 lives at 500 Main St', 'other'],
    ['status 200', 'other'],
    // Lowercase or embedded fake codes are not error codes.
    ['jane_smith_error at 12 Oak', 'other'],
    ['Jane_Smith_ERRORS here', 'other'],
    // An exception-looking name must be one identifier.
    ['Jane Smith Error: x', 'other'],
    ['exit code 1; rm -rf', 'exit code 1'],
    // A name in front of a real exception is not an identifier.
    ['Voter Jane Doe KeyError: x', 'other'],
    // Past the length cap, not an exception name at all.
    [`${'A'.repeat(70)}Error: x`, 'other'],
    // Exit codes are at most three digits; a longer number is data.
    ['exit code 1234', 'other'],
    // The right shape, but a person: printed only as the kind.
    ['Traceback ...\nMariaGonzalezError: x', 'other exception'],
    ['DoeException', 'other exception'],
    ['[JOHN_SMITH_ERROR] at 12 Oak St', 'other error code'],
    // An upper-case token that is not a code shape at all.
    ["KeyError: 'PARAMS_JSON'", 'KeyError'],
    ['missing JANE_DOE in params', 'other'],
  ])('does not leak from %j', (message, expected) => {
    expect(errorClass(message)).toBe(expected)
  })
})

describe('publicToolName', () => {
  it.each([
    'Bash',
    'WebSearch',
    'Agent',
    'mcp__broker__GET_community_issues',
    'mcp__broker__POST_domains_search',
    'mcp__broker__GET_ordinances_slug',
  ])('keeps the background tool %s', (tool) => {
    expect(publicToolName(tool, 'background')).toBe(tool)
  })

  it.each([
    'lookup_jane_doe',
    'mcp__broker__jane_doe',
    // The right shape, but no such route: a model can invent one.
    'mcp__broker__GET_jane_doe_voter_record',
    'jane_doe_mcp__broker__GET_community_issues',
    'mcp__broker__GET_community_issues_jane',
    'mcp__broker__GET_Jane_Doe',
    'mcp__broker__GET_jane doe',
    'mcp__other__GET_x',
    'bash',
    'Jane Smith',
    '<img src=x>',
    '',
  ])('refuses the background tool %j', (tool) => {
    expect(publicToolName(tool, 'background')).toBe('unknown')
  })

  it('keeps a chat tool name and refuses anything else', () => {
    expect(publicToolName('query_constituent_data', 'chat')).toBe(
      'query_constituent_data',
    )
    expect(publicToolName('Jane Smith', 'chat')).toBe('unknown')
    expect(publicToolName('x'.repeat(65), 'chat')).toBe('unknown')
  })
})
