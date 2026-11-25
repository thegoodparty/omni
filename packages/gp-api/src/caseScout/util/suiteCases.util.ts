// Reads case ids and grading conditions out of a pairwise suite's source.
// The suites cannot be imported here: the production build leaves out
// `*.eval.ts`, they import a dev-only package, and importing one registers
// vitest tests. suiteCases.util.test.ts checks this reader against the
// TypeScript AST of the real suites, so a case it would misread fails CI.

export type SuiteCase = { caseId: string; condition?: string }

export type SuiteCases = { cases: SuiteCase[]; unreadConditions: number }

type Token =
  | { kind: 'string'; value: string; readable: boolean }
  | { kind: 'word'; value: string }
  | { kind: 'punct'; value: string }

const CASE_ID = /^[A-Za-z0-9_-]+$/
const WORD_CHAR = /[A-Za-z0-9_$]/
const SIMPLE_ESCAPES: Record<string, string> = {
  n: '\n',
  t: '\t',
  r: '\r',
  b: '\b',
  f: '\f',
  v: '\v',
  0: '\0',
}

// Decodes the escape at source[at] (the character after the backslash) and
// returns the text plus the index after it, or null when it is malformed.
const readEscape = (
  source: string,
  at: number,
): { text: string; next: number } | null => {
  const c = source.charAt(at)
  if (c === '') return null
  if (c === '\r') {
    return { text: '', next: source.charAt(at + 1) === '\n' ? at + 2 : at + 1 }
  }
  if (c === '\n' || c === ' ' || c === ' ') {
    return { text: '', next: at + 1 }
  }
  const simple = SIMPLE_ESCAPES[c]
  if (
    simple !== undefined &&
    !(c === '0' && /[0-9]/.test(source.charAt(at + 1)))
  ) {
    return { text: simple, next: at + 1 }
  }
  if (c === 'x') {
    const hex = source.slice(at + 1, at + 3)
    if (!/^[0-9A-Fa-f]{2}$/.test(hex)) return null
    return { text: String.fromCharCode(parseInt(hex, 16)), next: at + 3 }
  }
  if (c === 'u' && source.charAt(at + 1) === '{') {
    const end = source.indexOf('}', at + 2)
    const hex = end === -1 ? '' : source.slice(at + 2, end)
    if (!/^[0-9A-Fa-f]{1,6}$/.test(hex) || parseInt(hex, 16) > 0x10ffff) {
      return null
    }
    return { text: String.fromCodePoint(parseInt(hex, 16)), next: end + 1 }
  }
  if (c === 'u') {
    const hex = source.slice(at + 1, at + 5)
    if (!/^[0-9A-Fa-f]{4}$/.test(hex)) return null
    return { text: String.fromCharCode(parseInt(hex, 16)), next: at + 5 }
  }
  if (/[1-9]/.test(c)) return null
  return { text: c, next: at + 1 }
}

// One pass over the source. Comments are dropped, every string literal is one
// token, and a template literal with a `${` substitution is one unreadable
// token whose substitutions are tokenized as code.
const tokenize = (source: string): Token[] => {
  const tokens: Token[] = []
  // Brace depth in the code being read, and the depth to return to as each
  // open template substitution closes, innermost last.
  let depth = 0
  const outerDepths: number[] = []
  let i = 0

  const readTemplate = (start: number, emit: boolean): number => {
    let value = ''
    let readable = true
    let j = start
    while (j < source.length) {
      const c = source.charAt(j)
      if (c === '`') {
        if (emit) tokens.push({ kind: 'string', value, readable })
        return j + 1
      }
      if (c === '$' && source.charAt(j + 1) === '{') {
        if (emit) tokens.push({ kind: 'string', value, readable: false })
        outerDepths.push(depth)
        depth = 0
        return j + 2
      }
      if (c === '\\') {
        const escape = readEscape(source, j + 1)
        if (escape === null) {
          readable = false
          j += 2
        } else {
          value += escape.text
          j = escape.next
        }
        continue
      }
      value += c
      j += 1
    }
    if (emit) tokens.push({ kind: 'string', value, readable: false })
    return j
  }

  while (i < source.length) {
    const c = source.charAt(i)
    if (/\s/.test(c)) {
      i += 1
    } else if (c === '/' && source.charAt(i + 1) === '/') {
      const end = source.indexOf('\n', i)
      i = end === -1 ? source.length : end + 1
    } else if (c === '/' && source.charAt(i + 1) === '*') {
      const end = source.indexOf('*/', i + 2)
      i = end === -1 ? source.length : end + 2
    } else if (c === "'" || c === '"') {
      let value = ''
      let readable = true
      let j = i + 1
      while (j < source.length && source.charAt(j) !== c) {
        if (source.charAt(j) === '\n') {
          readable = false
          break
        }
        if (source.charAt(j) === '\\') {
          const escape = readEscape(source, j + 1)
          if (escape === null) {
            readable = false
            j += 2
          } else {
            value += escape.text
            j = escape.next
          }
          continue
        }
        value += source.charAt(j)
        j += 1
      }
      if (j >= source.length) readable = false
      tokens.push({ kind: 'string', value, readable })
      i = j + 1
    } else if (c === '`') {
      i = readTemplate(i + 1, true)
    } else if (c === '{') {
      depth += 1
      tokens.push({ kind: 'punct', value: c })
      i += 1
    } else if (c === '}' && depth === 0 && outerDepths.length > 0) {
      depth = outerDepths.pop() ?? 0
      i = readTemplate(i + 1, false)
    } else if (c === '}') {
      depth -= 1
      tokens.push({ kind: 'punct', value: c })
      i += 1
    } else if (WORD_CHAR.test(c)) {
      let j = i
      while (j < source.length && WORD_CHAR.test(source.charAt(j))) j += 1
      tokens.push({ kind: 'word', value: source.slice(i, j) })
      i = j
    } else {
      tokens.push({ kind: 'punct', value: c })
      i += 1
    }
  }
  return tokens
}

const isPunct = (token: Token | undefined, value: string): boolean =>
  token?.kind === 'punct' && token.value === value

// A word is an object key only right after `{` or `,` and right before `:`,
// which leaves out `positionId`, `a ? id : b` and a key in a comment.
const isKey = (tokens: Token[], at: number, name: string): boolean => {
  const token = tokens[at]
  const before = tokens[at - 1]
  return (
    token?.kind === 'word' &&
    token.value === name &&
    (isPunct(before, '{') || isPunct(before, ',')) &&
    isPunct(tokens[at + 1], ':')
  )
}

// One string literal, or several joined by `+`, ending the property. Anything
// else (a variable, a call, a template with a substitution) is null.
const readConcatenation = (tokens: Token[], start: number): string | null => {
  let value = ''
  let at = start
  for (;;) {
    const token = tokens[at]
    if (token?.kind !== 'string' || !token.readable) return null
    value += token.value
    if (!isPunct(tokens[at + 1], '+')) break
    at += 2
  }
  const after = tokens[at + 1]
  return isPunct(after, ',') || isPunct(after, '}') ? value : null
}

export const readSuiteCases = (source: string): SuiteCases => {
  const tokens = tokenize(source)
  const cases: SuiteCase[] = []
  let current: SuiteCase | undefined
  let unreadConditions = 0
  for (let at = 0; at < tokens.length; at += 1) {
    if (isKey(tokens, at, 'id')) {
      const value = tokens[at + 2]
      current = undefined
      if (
        value?.kind === 'string' &&
        value.readable &&
        CASE_ID.test(value.value)
      ) {
        current = { caseId: value.value }
        cases.push(current)
      }
    } else if (isKey(tokens, at, 'condition')) {
      const condition = readConcatenation(tokens, at + 2)
      if (condition === null || current === undefined) {
        unreadConditions += 1
      } else {
        current.condition = condition
      }
    }
  }
  return { cases, unreadConditions }
}
