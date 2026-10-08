import {
  MAX_TOOL_ERROR_CHARS,
  type AgentShape,
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
//
// Allowlisted, not pattern-matched. A pattern lets a name through whenever it
// happens to have the right shape: `MariaGonzalezError` is an identifier
// ending in Error, and L2 writes names in upper case, so `JOHN_SMITH_ERROR`
// is a perfectly shaped error code. Only a token on these lists is printed;
// anything else that merely looks like one prints as its kind.
const KNOWN_EXCEPTIONS: ReadonlySet<string> = new Set([
  // Python builtins
  'KeyError',
  'ValueError',
  'TypeError',
  'IndexError',
  'AttributeError',
  'NameError',
  'RuntimeError',
  'FileNotFoundError',
  'PermissionError',
  'TimeoutError',
  'ConnectionError',
  'OSError',
  'ImportError',
  'ModuleNotFoundError',
  'AssertionError',
  'ZeroDivisionError',
  'NotImplementedError',
  'UnicodeDecodeError',
  'JSONDecodeError',
  // Common libraries
  'HTTPError',
  'HTTPStatusError',
  'ConnectError',
  'ReadTimeout',
  'ClientError',
  'ValidationError',
  // JavaScript
  'ReferenceError',
  'SyntaxError',
  'RangeError',
  // Ours: the chat seam's forced failure and the warehouse client
  'ToolFailedError',
  'PeopleDbxUnavailableError',
])
const KNOWN_CODES: ReadonlySet<string> = new Set([
  'PARSE_SYNTAX_ERROR',
  'TABLE_OR_VIEW_NOT_FOUND',
  'UNRESOLVED_COLUMN',
  'PERMISSION_DENIED',
  'INSUFFICIENT_PERMISSIONS',
  'DIVIDE_BY_ZERO',
  'CAST_INVALID_INPUT',
  'INVALID_PARAMETER_VALUE',
  'RESOURCE_DOES_NOT_EXIST',
  'TEMPORARILY_UNAVAILABLE',
  'DEADLINE_EXCEEDED',
])
// The shape that marks the last line as an exception at all. Only decides
// between a known name and `other exception`; it never prints what it saw.
const EXCEPTION_NAME = /^[A-Z][A-Za-z0-9]{0,60}(?:Error|Exception|Warning)$/
const UPPER_TOKEN = /\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+\b/g
const CODE_SHAPE = /_(?:ERROR|EXCEPTION)$/
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

const exceptionClass = (message: string): string | undefined => {
  // The type is everything before the first colon on the last line, minus a
  // dotted module path: `json.decoder.JSONDecodeError: ...`.
  const head = lastLine(message).split(':')[0]?.trim() ?? ''
  const name = head.split('.').at(-1) ?? ''
  if (KNOWN_EXCEPTIONS.has(name)) return name
  return EXCEPTION_NAME.test(name) ? 'other exception' : undefined
}

const codeClass = (message: string): string | undefined => {
  const tokens = message.match(UPPER_TOKEN) ?? []
  const known = tokens.find((token) => KNOWN_CODES.has(token))
  if (known !== undefined) return known
  return tokens.some((token) => CODE_SHAPE.test(token))
    ? 'other error code'
    : undefined
}

// A chat run over HTTP sees a failed tool only as a tool_call the stream
// never answered with a tool_result; the error text does not cross the wire.
export const UNRECORDED_TOOL_ERROR =
  'unrecorded: no tool_result followed this tool_call, and the stream does ' +
  'not carry the error text'

export const errorClass = (message: string): string => {
  if (message === UNRECORDED_TOOL_ERROR) return 'unrecorded'
  const exception = exceptionClass(message)
  if (exception !== undefined) return exception
  const code = codeClass(message)
  if (code !== undefined) return code
  const http = HTTP_STATUS.exec(message)?.[1]
  if (http !== undefined) return `HTTP ${http}`
  if (TIMEOUT.test(message)) return 'timeout'
  const exit = EXIT_CODE.exec(message)?.[1]
  if (exit !== undefined) return `exit code ${exit}`
  return 'other'
}

// A background agent's tool name is whatever the model emitted, so a call
// to an invented `lookup_jane_doe` that fails would print the name. Public
// only if it is a harness built-in or a real broker MCP tool, whose names
// gp-api derives from the route template (mcp/util/toolName.util.ts), so
// they never carry a value.
const BACKGROUND_TOOLS: ReadonlySet<string> = new Set([
  'Bash',
  'Read',
  'Write',
  'Edit',
  'MultiEdit',
  'Glob',
  'Grep',
  'LS',
  'WebSearch',
  'WebFetch',
  'TodoWrite',
  'NotebookEdit',
  'Task',
  'Agent',
])
export const BROKER_TOOL_PREFIX = 'mcp__broker__'
// Names, not a pattern: a model can invent a well-shaped name with a voter in
// it, and a call to a tool that does not exist fails, which is exactly what
// lands here. knownBrokerTools.db.test.ts keeps this equal to the real list.
export const KNOWN_BROKER_TOOLS: ReadonlySet<string> = new Set([
  `${BROKER_TOOL_PREFIX}GET_campaigns_mine`,
  `${BROKER_TOOL_PREFIX}GET_campaigns_tcr_compliance_mine_compliance_state`,
  `${BROKER_TOOL_PREFIX}GET_campaigns_tracker_tasks`,
  `${BROKER_TOOL_PREFIX}GET_community_issues`,
  `${BROKER_TOOL_PREFIX}GET_ordinances`,
  `${BROKER_TOOL_PREFIX}GET_ordinances_slug`,
  `${BROKER_TOOL_PREFIX}GET_priorities`,
  `${BROKER_TOOL_PREFIX}GET_websites_mine`,
  `${BROKER_TOOL_PREFIX}POST_campaigns_tcr_compliance_submit_to_peerly`,
  `${BROKER_TOOL_PREFIX}POST_domains_purchase`,
  `${BROKER_TOOL_PREFIX}POST_domains_search`,
  `${BROKER_TOOL_PREFIX}POST_websites_mine_verify_live`,
  `${BROKER_TOOL_PREFIX}PUT_websites_mine`,
])
// A chat tool name is one gp-api registered in code, which the chat runner
// checks before it writes the record; this is the shape those names have.
const CHAT_TOOL = /^[a-z][a-z0-9_]{0,63}$/

export const publicToolName = (tool: string, shape: AgentShape): string => {
  const known =
    shape === 'chat'
      ? CHAT_TOOL.test(tool)
      : BACKGROUND_TOOLS.has(tool) || KNOWN_BROKER_TOOLS.has(tool)
  return known ? tool : 'unknown'
}
