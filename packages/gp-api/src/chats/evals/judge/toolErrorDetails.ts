import {
  MAX_TOOL_ERROR_CHARS,
  MAX_TOOL_ERROR_DETAILS,
  type ToolErrorDetail,
} from './record'
import { scrubReason } from './sweepArm'

// scrubReason covers the secrets an arm's own environment holds. Tool output
// is wider than that: a background agent's Bash result is whatever the shell
// printed, which can carry a bearer token, a signed URL's key, a voter's
// email or a contact id. These shapes catch what the env-value pass cannot.
//
// Best effort, and it only guards the record, which stays private. No shape
// catches a name or a street address, which is why nothing public ever
// renders this text: the report prints `errorClass` instead.
const DETAIL_SHAPES: readonly [RegExp, string][] = [
  [/\beyJ[\w-]+\.[\w-]+\.[\w-]+/g, '[redacted token]'],
  [/\b(Bearer|Basic)\s+[\w.~+/-]+=*/gi, '$1 [redacted token]'],
  [/\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g, '[redacted key]'],
  // No leading word boundary: `aws_secret_access_key` has none before
  // `_access`, and that is the key this most needs to catch.
  [
    /([\w-]*(?:api[_-]?key|access[_-]?key|token|secret|password|passwd|signature|credential|authorization)[\w-]*)(["']?\s*[:=]\s*["']?)[^\s"'&,;}]+/gi,
    '$1$2[redacted]',
  ],
  [/\bhttps?:\/\/\S+/gi, '[url]'],
  [/\b\d{1,3}(?:\.\d{1,3}){3}\b/g, '[ip]'],
  [
    /\b[\w-]+(?:\.[\w-]+)*\.(?:internal|local|lan|corp|amazonaws\.com|databricks\.com)\b/gi,
    '[host]',
  ],
  [/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '[id]'],
  [/[\w.+-]+@[\w-]+\.[\w.]+/g, '[email]'],
  [/\b\d{3}-\d{2}-\d{4}\b/g, '[ssn]'],
  [/(?:\(\d{3}\)\s*|\b\d{3}[-.\s])\d{3}[-.\s]\d{4}\b/g, '[phone]'],
  // An unlabelled secret: AWS's is 40 base64 characters with no prefix. A
  // long run mixing letters and digits is redacted whatever it is.
  [
    /(?<![\w/+])(?=[\w/+-]*\d)(?=[\w/+-]*[A-Za-z])[\w/+-]{32,}={0,2}/g,
    '[redacted token]',
  ],
  [/\d{7,}/g, '[digits]'],
]

export const redactToolError = (
  text: string,
  env: NodeJS.ProcessEnv = process.env,
): string =>
  DETAIL_SHAPES.reduce(
    (out, [pattern, replacement]) => out.replace(pattern, replacement),
    scrubReason(text, env),
  )

const ELLIPSIS = ' … '
const HEAD_CHARS = 100

// Both ends survive the cut, not just the head. A failing Bash call opens
// with "Exit code 1" and a traceback and ends with the exception that names
// the cause, so a head-only cut keeps exactly the part nobody needs.
const bound = (text: string): string => {
  if (text.length <= MAX_TOOL_ERROR_CHARS) return text
  const tail = MAX_TOOL_ERROR_CHARS - HEAD_CHARS - ELLIPSIS.length
  return `${text.slice(0, HEAD_CHARS)}${ELLIPSIS}${text.slice(-tail)}`
}

// Redacted before it is cut, so a cut can never leave half a secret that no
// longer matches its shape.
export const toolErrorDetail = (
  tool: string | undefined,
  message: string,
  env: NodeJS.ProcessEnv = process.env,
): ToolErrorDetail => {
  const text = bound(redactToolError(message, env).trim())
  return {
    tool: tool === undefined || tool === '' ? 'unknown' : tool,
    message: text === '' ? 'no error text' : text,
  }
}

export const capToolErrorDetails = (
  details: readonly ToolErrorDetail[],
): ToolErrorDetail[] => details.slice(0, MAX_TOOL_ERROR_DETAILS)

// WHAT A PUBLIC PAGE MAY SAY ABOUT A TOOL ERROR. omni is public, and the
// report reaches the run log and $GITHUB_STEP_SUMMARY. A tool error is free
// text that can echo voter data — a Databricks error quoting its WHERE
// clause, a KeyError keyed on a name — and redaction cannot recognise a name
// or an address. So the public output is an allowlist: one of these fixed
// classes, built only from the captured token, never from the message.
// One identifier ending in Error, Exception or Warning, which covers every
// builtin worth naming (KeyError, JSONDecodeError, TimeoutError, ...).
const EXCEPTION_NAME = /^[A-Z][A-Za-z0-9]{0,60}(?:Error|Exception|Warning)$/
const ERROR_CODE = /\b([A-Z][A-Z_]{1,60}_(?:ERROR|EXCEPTION))\b/
const EXIT_CODE = /\bexit code (\d{1,3})\b/i
const HTTP_STATUS =
  /\b(?:HTTP(?:\/\d(?:\.\d)?)?|status(?: code)?|response(?: code)?)[\s:=]*([45]\d\d)\b/i
const TIMEOUT = /\btime(?:d)?[\s-]?out\b/i

const lastLine = (message: string): string =>
  message
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '')
    .at(-1) ?? ''

const exceptionName = (message: string): string | undefined => {
  // The type is everything before the first colon on the last line, minus a
  // dotted module path: `json.decoder.JSONDecodeError: ...`.
  const head = lastLine(message).split(':')[0]?.trim() ?? ''
  const name = head.split('.').at(-1) ?? ''
  return EXCEPTION_NAME.test(name) ? name : undefined
}

export const errorClass = (message: string): string => {
  const exception = exceptionName(message)
  if (exception !== undefined) return exception
  const code = ERROR_CODE.exec(message)?.[1]
  if (code !== undefined) return code
  const http = HTTP_STATUS.exec(message)?.[1]
  if (http !== undefined) return `HTTP ${http}`
  if (TIMEOUT.test(message)) return 'timeout'
  const exit = EXIT_CODE.exec(message)?.[1]
  if (exit !== undefined) return `exit code ${exit}`
  return 'other'
}

const SAFE_TOOL = /^[A-Za-z0-9_.:-]{1,80}$/

export const publicToolName = (tool: string): string =>
  SAFE_TOOL.test(tool) ? tool : 'unknown'
