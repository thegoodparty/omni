import { isNotNil } from 'es-toolkit'

const MIN_SECRET_LENGTH = 8

// Authorization credentials reach logs in two shapes: the raw header
// (`Authorization: Bearer x`) and the JSON-serialized header bag pino emits
// when an Axios error is logged (`"authorization":"JWT x"`). Match both, for
// any scheme (Bearer, JWT, Basic, Token, or one we've never seen), and keep
// the scheme itself in the output — it aids debugging and leaks nothing.
// The `\\*` before each quote covers callers that JSON.stringify an error
// into a log message, which escapes the quotes one or more levels deep.
// Deliberately biased toward over-redaction: prose that happens to contain
// `authorization:` loses its tail rather than risking a live credential.
const AUTH_HEADER_PATTERN =
  /("authorization\\*"[ \t]*:[ \t]*\\*"|authorization:[ \t]*)([a-z][a-z0-9-]*[ \t]+)?[^"\\\n]+/gi

const buildSecretPattern = (): RegExp => {
  const escaped = (process.env.SECRET_NAMES ?? '')
    .split(',')
    .map((name) => process.env[name])
    .filter(isNotNil)
    .filter((s) => s.length >= MIN_SECRET_LENGTH)
    .map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))

  escaped.push(
    '(?<=[?&](?:token|key|secret|password|access_token|api_key|apiKey|client_secret|credentials)=)[^&"\\\\]+',
  )
  escaped.push('(?<=:\\/\\/[^:]*:)[^@"\\\\]+(?=@)')

  return new RegExp(escaped.join('|'), 'g')
}

const secretPattern = buildSecretPattern()

export const redactLine = (line: string): string =>
  line
    .replace(
      AUTH_HEADER_PATTERN,
      (_match, prefix: string, scheme: string | undefined) =>
        `${prefix}${scheme ?? ''}[REDACTED]`,
    )
    .replace(secretPattern, '[REDACTED]')
