import mammoth from 'mammoth'
import { PDFParse } from 'pdf-parse'
import sanitizeHtml from 'sanitize-html'
import TurndownService from 'turndown'
import { declaredZipUncompressedSize } from '@/ocr/util/zipInflationGuard.util'

// sanitize-html and turndown block the event loop, so the input is bounded.
const MAX_HTML_CONVERT_BYTES = 1_500_000
const MAX_DOCX_UNCOMPRESSED_BYTES = 100 * 1024 * 1024
// A Word file has no pages, so it is cut into page-sized sections.
const DOCX_SECTION_CHARS = 4_000

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

// pdf-parse (the library gp-api's OCR extractor uses) page by page, so a
// tool can read a page range and cite page numbers. Runs on the main thread:
// a 641-page packet takes about two seconds.
export const documentPages = async (
  kind: DocumentKind,
  body: Buffer,
): Promise<string[]> => {
  if (kind === 'pdf') {
    const parser = new PDFParse({ data: new Uint8Array(body) })
    try {
      const result = await parser.getText()
      return result.pages
        .sort((a, b) => a.num - b.num)
        .map((page) => page.text.trim())
    } finally {
      await parser.destroy()
    }
  }
  const declared = declaredZipUncompressedSize(body)
  if (declared === null || declared > MAX_DOCX_UNCOMPRESSED_BYTES) {
    throw new Error('docx_rejected_zip_structure')
  }
  const text = ((await mammoth.extractRawText({ buffer: body })).value ?? '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  const sections: string[] = []
  for (let i = 0; i < text.length; i += DOCX_SECTION_CHARS) {
    sections.push(text.slice(i, i + DOCX_SECTION_CHARS))
  }
  return sections.length > 0 ? sections : ['']
}
