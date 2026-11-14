import { parentPort } from 'node:worker_threads'
import mammoth from 'mammoth'
import { PDFParse } from 'pdf-parse'
// Relative, not '@/': under tsx the alias resolves against the caller's cwd.
import { declaredZipUncompressedSize } from '../../ocr/util/zipInflationGuard.util'
import type { DocumentParseReply, DocumentParseRequest } from './webText'

const MAX_DOCX_UNCOMPRESSED_BYTES = 100 * 1024 * 1024
// A Word file has no pages, so it is cut into page-sized sections.
const DOCX_SECTION_CHARS = 4_000

// pdf-parse (the library gp-api's OCR extractor uses) page by page, so a
// tool can read a page range and cite page numbers.
const parse = async ({
  kind,
  body,
}: DocumentParseRequest): Promise<string[]> => {
  if (kind === 'pdf') {
    const parser = new PDFParse({ data: body })
    try {
      const result = await parser.getText()
      return result.pages
        .sort((a, b) => a.num - b.num)
        .map((page) => page.text.trim())
    } finally {
      await parser.destroy()
    }
  }
  const buffer = Buffer.from(body.buffer, body.byteOffset, body.byteLength)
  const declared = declaredZipUncompressedSize(buffer)
  if (declared === null || declared > MAX_DOCX_UNCOMPRESSED_BYTES) {
    throw new Error('docx_rejected_zip_structure')
  }
  const text = ((await mammoth.extractRawText({ buffer })).value ?? '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  const sections: string[] = []
  for (let i = 0; i < text.length; i += DOCX_SECTION_CHARS) {
    sections.push(text.slice(i, i + DOCX_SECTION_CHARS))
  }
  return sections.length > 0 ? sections : ['']
}

parentPort?.on('message', (request: DocumentParseRequest) => {
  void parse(request).then(
    (pages) => {
      const reply: DocumentParseReply = { ok: true, pages }
      parentPort?.postMessage(reply)
    },
    (err: unknown) => {
      const reply: DocumentParseReply = {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      }
      parentPort?.postMessage(reply)
    },
  )
})
