import { join } from 'node:path'
import { Worker } from 'node:worker_threads'
import sanitizeHtml from 'sanitize-html'
import TurndownService from 'turndown'

// sanitize-html and turndown block the event loop, so the input is bounded.
const MAX_HTML_CONVERT_BYTES = 1_500_000

const DOCX_MIME =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document'

const absoluteHref = (href: string | undefined, baseUrl: string) => {
  if (!href) return href
  try {
    return new URL(href, baseUrl).toString()
  } catch {
    return href
  }
}

// Links come out absolute, so a model can pass an agenda's packet link
// straight to readDocument.
export const markdownFromHtml = (html: string, baseUrl: string): string => {
  const bounded =
    html.length > MAX_HTML_CONVERT_BYTES
      ? html.slice(0, MAX_HTML_CONVERT_BYTES)
      : html
  const cleaned = sanitizeHtml(bounded, {
    allowedTags: sanitizeHtml.defaults.allowedTags,
    allowedAttributes: { a: ['href'] },
    transformTags: {
      a: (tagName, attribs) => ({
        tagName,
        attribs: {
          ...attribs,
          href: absoluteHref(attribs.href, baseUrl) ?? '',
        },
      }),
    },
  })
  return new TurndownService({
    headingStyle: 'atx',
    codeBlockStyle: 'fenced',
  })
    .turndown(cleaned)
    .trim()
}

export const looksLikeHtml = (body: string): boolean =>
  /<(html|head|body|div|p|a|table|span|script)\b/i.test(body.slice(0, 20_000))

const CHALLENGE_MARKERS =
  /cf-chl-|challenge-platform|<title>\s*just a moment|checking your browser|ddos protection by|captcha-delivery|_incapsula_resource/i

const JS_REQUIRED_MARKERS =
  /(enable|turn on)\s+javascript|javascript\s+(is\s+)?(turned off|disabled|required)|requires?\s+javascript|loading\s*(\.\.\.|…)/i

// When a plain fetch's page needs a browser to read. Thin pages, bot
// challenges, and pages that say they need JavaScript and carry little text
// (a CivicWeb meeting page is "Loading..." plus 10k characters of navigation).
export const needsBrowser = (
  status: number,
  html: string,
  markdown: string,
): boolean => {
  if (status === 403 || status === 429 || status === 503) return true
  if (CHALLENGE_MARKERS.test(html)) return true
  if (markdown.length < 400) return true
  return JS_REQUIRED_MARKERS.test(html) && markdown.length < 15_000
}

export type DocumentKind = 'pdf' | 'docx'

export const documentKind = (
  contentType: string,
  body: Buffer,
  url: string,
): DocumentKind | undefined => {
  const type = contentType.toLowerCase()
  if (type.includes('application/pdf')) return 'pdf'
  if (body.subarray(0, 5).toString('latin1') === '%PDF-') return 'pdf'
  if (type.includes(DOCX_MIME)) return 'docx'
  const isZip = body.subarray(0, 2).toString('latin1') === 'PK'
  if (isZip && /\.docx(\?|#|$)/i.test(url)) return 'docx'
  return undefined
}

export type DocumentParseRequest = { kind: DocumentKind; body: Uint8Array }
export type DocumentParseReply =
  | { ok: true; pages: string[] }
  | { ok: false; error: string }

// pdf-parse and mammoth hold the event loop for the whole parse (about a
// second for a 1,000-page packet), so they run in one worker thread per
// process and parses queue for it. Under tsx and vitest the worker is the
// TypeScript source, loaded through tsx.
const PARSE_WORKER_FILE = join(
  __dirname,
  __filename.endsWith('.ts')
    ? 'documentParse.worker.ts'
    : 'documentParse.worker.js',
)
// A document that never finishes would hold every later parse in the queue.
const PARSE_TIMEOUT_MS = 120_000

let parseWorker: Worker | undefined
let parseQueue: Promise<unknown> = Promise.resolve()

const startParseWorker = (): Worker => {
  const worker = new Worker(PARSE_WORKER_FILE, {
    execArgv: PARSE_WORKER_FILE.endsWith('.ts') ? ['--import', 'tsx'] : [],
  })
  worker.on('error', () => undefined)
  worker.on('exit', () => {
    if (parseWorker === worker) parseWorker = undefined
  })
  worker.unref()
  return worker
}

const parseInWorker = (kind: DocumentKind, body: Buffer): Promise<string[]> =>
  new Promise((resolve, reject) => {
    const worker = parseWorker ?? startParseWorker()
    parseWorker = worker
    const settle = () => {
      clearTimeout(timeout)
      worker.off('message', onMessage)
      worker.off('error', onError)
      worker.off('exit', onExit)
      worker.unref()
    }
    const onMessage = (reply: DocumentParseReply) => {
      settle()
      if (reply.ok) resolve(reply.pages)
      else reject(new Error(reply.error))
    }
    const onError = (err: Error) => {
      settle()
      if (parseWorker === worker) parseWorker = undefined
      reject(err)
    }
    const onExit = (code: number) => {
      settle()
      if (parseWorker === worker) parseWorker = undefined
      reject(new Error(`document parser exited with code ${code}`))
    }
    const timeout = setTimeout(() => {
      settle()
      if (parseWorker === worker) parseWorker = undefined
      void worker.terminate()
      reject(new Error('document_parse_timeout'))
    }, PARSE_TIMEOUT_MS)
    worker.on('message', onMessage)
    worker.on('error', onError)
    worker.on('exit', onExit)
    worker.ref()
    const copy = new Uint8Array(body)
    const request: DocumentParseRequest = { kind, body: copy }
    worker.postMessage(request, [copy.buffer])
  })

// Pages in order, for a tool to read a page range and cite page numbers.
export const documentPages = (
  kind: DocumentKind,
  body: Buffer,
): Promise<string[]> => {
  const parsed = parseQueue.then(() => parseInWorker(kind, body))
  parseQueue = parsed.catch(() => undefined)
  return parsed
}
