// A small MIME reader for the replies SES stores in S3. It reads headers,
// walks multipart bodies and returns the first plain text part, which is all
// classification and forwarding need. Attachments are never read.

export type MimeAddress = { address: string; name: string | null }

export type ParsedMime = {
  headers: Map<string, string[]>
  text: string
}

const MAX_DEPTH = 5
const MAX_PARTS = 50
const MAX_HEADER_CHARS = 2_000
const MAX_BODY_CHARS = 400_000

const decodeBytes = (bytes: Buffer, charset: string | undefined): string => {
  try {
    return new TextDecoder(charset ?? 'utf-8').decode(bytes)
  } catch {
    return bytes.toString('utf8')
  }
}

const splitHeadBody = (raw: string): { head: string; body: string } => {
  const match = /\r?\n\r?\n/.exec(raw)
  if (!match) return { head: raw, body: '' }
  return {
    head: raw.slice(0, match.index),
    body: raw.slice(match.index + match[0].length),
  }
}

const parseHeaders = (head: string): Map<string, string[]> => {
  const headers = new Map<string, string[]>()
  const unfolded = head.replace(/\r?\n[ \t]+/g, ' ')
  for (const line of unfolded.split(/\r?\n/)) {
    const colon = line.indexOf(':')
    if (colon <= 0) continue
    const name = line.slice(0, colon).trim().toLowerCase()
    const value = line
      .slice(colon + 1)
      .trim()
      .slice(0, MAX_HEADER_CHARS)
    headers.set(name, [...(headers.get(name) ?? []), value])
  }
  return headers
}

export const decodeQuotedPrintable = (input: string): Buffer => {
  const joined = input.replace(/=\r?\n/g, '')
  const out: number[] = []
  for (let i = 0; i < joined.length; i++) {
    const hex = joined.slice(i + 1, i + 3)
    if (joined[i] === '=' && /^[0-9A-Fa-f]{2}$/.test(hex)) {
      out.push(parseInt(hex, 16))
      i += 2
    } else {
      out.push(joined.charCodeAt(i) & 0xff)
    }
  }
  return Buffer.from(out)
}

const ENCODED_WORD = /=\?([^?]+)\?([bBqQ])\?([^?]*)\?=/g

export const decodeEncodedWords = (value: string): string =>
  value
    .replace(/(\?=)\s+(=\?)/g, '$1$2')
    .replace(ENCODED_WORD, (_, charset: string, enc: string, data: string) => {
      const bytes =
        enc.toLowerCase() === 'b'
          ? Buffer.from(data, 'base64')
          : decodeQuotedPrintable(data.replace(/_/g, ' '))
      return decodeBytes(bytes, charset)
    })

export const headerValue = (
  headers: Map<string, string[]>,
  name: string,
): string | undefined => headers.get(name.toLowerCase())?.[0]

const paramOf = (value: string, param: string): string | undefined => {
  const match = new RegExp(`${param}\\s*=\\s*("([^"]*)"|[^;\\s]+)`, 'i').exec(
    value,
  )
  return match?.[2] ?? match?.[1]
}

const mediaType = (value: string | undefined): string =>
  (value ?? 'text/plain').split(';')[0]?.trim().toLowerCase() ?? 'text/plain'

const HTML_ENTITIES: [string, string][] = [
  ['&nbsp;', ' '],
  ['&lt;', '<'],
  ['&gt;', '>'],
  ['&quot;', '"'],
  ['&#39;', "'"],
  ['&amp;', '&'],
]

// A single pass with indexOf, so hostile markup can't make it quadratic.
const stripHtml = (html: string): string => {
  const lower = html.toLowerCase()
  let out = ''
  let i = 0
  while (i < html.length) {
    const open = html.indexOf('<', i)
    if (open === -1) {
      out += html.slice(i)
      break
    }
    out += html.slice(i, open)
    const close = html.indexOf('>', open)
    if (close === -1) break
    const tag = html.slice(open + 1, close).toLowerCase()
    const name = /^\/?([a-z0-9]+)/.exec(tag.slice(0, 20))?.[1]
    if ((name === 'style' || name === 'script') && !tag.startsWith('/')) {
      const end = lower.indexOf(`</${name}`, close)
      i = end === -1 ? html.length : end
      continue
    }
    if (
      name === 'br' ||
      (tag.startsWith('/') && /^\/(p|div|li|tr)$/.test(tag))
    ) {
      out += '\n'
    }
    i = close + 1
  }
  const decoded = HTML_ENTITIES.reduce(
    (text, [entity, char]) => text.split(entity).join(char),
    out,
  )
  return decoded.replace(/\n{3,}/g, '\n\n').trim()
}

const decodeBody = (
  fullBody: string,
  headers: Map<string, string[]>,
): string => {
  const body = fullBody.slice(0, MAX_BODY_CHARS)
  const encoding = (
    headerValue(headers, 'content-transfer-encoding') ?? '7bit'
  ).toLowerCase()
  const charset = paramOf(headerValue(headers, 'content-type') ?? '', 'charset')
  const bytes =
    encoding === 'base64'
      ? Buffer.from(body.replace(/\s+/g, ''), 'base64')
      : encoding === 'quoted-printable'
        ? decodeQuotedPrintable(body)
        : Buffer.from(body, 'binary')
  return decodeBytes(bytes, charset)
}

type Found = { plain: string | null; html: string | null }

const collectText = (
  head: Map<string, string[]>,
  body: string,
  found: Found,
  depth: number,
  budget: { parts: number },
) => {
  if (depth > MAX_DEPTH || budget.parts-- <= 0) return
  const contentType = headerValue(head, 'content-type')
  const type = mediaType(contentType)
  const disposition = headerValue(head, 'content-disposition') ?? ''
  if (/^\s*attachment/i.test(disposition)) return

  if (type.startsWith('multipart/')) {
    const boundary = paramOf(contentType ?? '', 'boundary')
    if (!boundary) return
    for (const part of body.split(`--${boundary}`).slice(1)) {
      if (part.startsWith('--')) break
      const { head: partHead, body: partBody } = splitHeadBody(
        part.replace(/^\r?\n/, ''),
      )
      collectText(parseHeaders(partHead), partBody, found, depth + 1, budget)
    }
    return
  }
  if (type === 'text/plain' && found.plain === null) {
    found.plain = decodeBody(body, head)
  } else if (type === 'text/html' && found.html === null) {
    found.html = decodeBody(body, head)
  }
}

export const parseMime = (raw: Buffer): ParsedMime => {
  const { head, body } = splitHeadBody(raw.toString('binary'))
  const headers = parseHeaders(head)
  const found: Found = { plain: null, html: null }
  collectText(headers, body, found, 0, { parts: MAX_PARTS })
  const text = found.plain ?? (found.html !== null ? stripHtml(found.html) : '')
  return { headers, text: text.replace(/\r\n/g, '\n').trim() }
}

// Header text arrives as binary-decoded bytes; re-read it as UTF-8 so raw
// non-ASCII header values survive, then decode any RFC 2047 words.
export const readHeader = (
  headers: Map<string, string[]>,
  name: string,
): string | undefined => {
  const value = headerValue(headers, name)
  if (value === undefined) return undefined
  return decodeEncodedWords(Buffer.from(value, 'binary').toString('utf8'))
}

const ADDRESS = /([^\s<>"',;]+@[^\s<>"',;]+)/
const ANGLE_ADDRESS = /^<?([^<>\s]+@[^<>\s]+)>?$/

const splitAddressList = (value: string): string[] => {
  const parts: string[] = []
  let current = ''
  let quoted = false
  for (const char of value) {
    if (char === '"') quoted = !quoted
    if (char === ',' && !quoted) {
      parts.push(current)
      current = ''
    } else {
      current += char
    }
  }
  return [...parts, current]
}

export const parseAddresses = (value: string | undefined): MimeAddress[] => {
  if (!value) return []
  const found: MimeAddress[] = []
  for (const part of splitAddressList(value.slice(0, MAX_HEADER_CHARS))) {
    const trimmed = part.trim()
    const open = trimmed.lastIndexOf('<')
    const close = trimmed.lastIndexOf('>')
    if (open !== -1 && close > open) {
      const address = ANGLE_ADDRESS.exec(trimmed.slice(open, close + 1))?.[1]
      if (address) {
        const name = trimmed
          .slice(0, open)
          .trim()
          .replace(/^"(.*)"$/, '$1')
          .trim()
        found.push({
          address: address.toLowerCase(),
          name: name ? name : null,
        })
        continue
      }
    }
    const bare = ADDRESS.exec(part)?.[1]
    if (bare) found.push({ address: bare.toLowerCase(), name: null })
  }
  return found
}

// What the sender wrote, without the quoted thread under it.
export const stripQuotedReply = (text: string): string => {
  const lines = text.split('\n')
  const kept: string[] = []
  for (const line of lines) {
    if (/^\s*>/.test(line)) continue
    if (/^On .+wrote:\s*$/i.test(line.trim())) break
    if (/^-{2,}\s*(original message|forwarded message)/i.test(line.trim()))
      break
    if (/^_{5,}$/.test(line.trim())) break
    kept.push(line)
  }
  return kept.join('\n').trim()
}
