import { z } from 'zod'

const FENCE = /^\s*```(?:json)?|```\s*$/gm

// Samuel's digest's extract_json: strip code fences, then read the first
// balanced value by bracket depth, ignoring brackets inside strings. A model
// that adds prose around its JSON still parses.
const extractBalanced = (
  text: string,
  open: '{' | '[',
  close: '}' | ']',
): z.core.util.JSONType => {
  const stripped = text.trim().replace(FENCE, '')
  const start = stripped.indexOf(open)
  if (start < 0) {
    throw new Error(`no JSON ${open === '{' ? 'object' : 'array'} in output`)
  }
  let depth = 0
  let inString = false
  let escaped = false
  for (let i = start; i < stripped.length; i++) {
    const ch = stripped[i]
    if (inString) {
      if (escaped) escaped = false
      else if (ch === '\\') escaped = true
      else if (ch === '"') inString = false
      continue
    }
    if (ch === '"') inString = true
    else if (ch === open) depth++
    else if (ch === close) {
      depth--
      if (depth === 0) {
        return z.json().parse(JSON.parse(stripped.slice(start, i + 1)))
      }
    }
  }
  throw new Error('unbalanced JSON in output')
}

export const extractJsonObject = (text: string): z.core.util.JSONType =>
  extractBalanced(text, '{', '}')

export const extractJsonArray = (text: string): z.core.util.JSONType =>
  extractBalanced(text, '[', ']')
