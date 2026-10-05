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
const DETAIL_SHAPES: readonly [RegExp, string][] = [
  [/\beyJ[\w-]+\.[\w-]+\.[\w-]+/g, '[redacted token]'],
  [/\bBearer\s+[\w.~+/-]+=*/gi, 'Bearer [redacted token]'],
  [/\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g, '[redacted key]'],
  [
    /\b(api[_-]?key|access[_-]?key|token|secret|password|signature)(["']?\s*[:=]\s*["']?)[^\s"'&,;}]+/gi,
    '$1$2[redacted]',
  ],
  [/\b[0-9a-f]{32,}\b/gi, '[redacted token]'],
  [/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '[id]'],
  [/[\w.+-]+@[\w-]+\.[\w.]+/g, '[email]'],
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
