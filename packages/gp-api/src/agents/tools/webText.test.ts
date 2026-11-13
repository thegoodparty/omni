import { Document, Packer, Paragraph } from 'docx'
import PDFDocument from 'pdfkit'
import { describe, expect, it } from 'vitest'
import {
  documentKind,
  documentPages,
  markdownFromHtml,
  needsBrowser,
} from './webText'

const pdfWithPages = (pages: string[]): Promise<Buffer> =>
  new Promise((resolve, reject) => {
    const doc = new PDFDocument({ autoFirstPage: false })
    const chunks: Buffer[] = []
    doc.on('data', (chunk: Buffer) => chunks.push(chunk))
    doc.on('end', () => resolve(Buffer.concat(chunks)))
    doc.on('error', reject)
    for (const text of pages) {
      doc.addPage()
      doc.text(text)
    }
    doc.end()
  })

const filler = (words: number) => 'Council business. '.repeat(words)

describe('markdownFromHtml', () => {
  it('makes links absolute against the page URL', () => {
    const markdown = markdownFromHtml(
      '<p>See <a href="/document/12/packet.pdf?handle=AB">the packet</a></p>',
      'https://monroewa.civicweb.net/Portal/MeetingInformation.aspx?Id=1',
    )
    expect(markdown).toContain(
      '[the packet](https://monroewa.civicweb.net/document/12/packet.pdf?handle=AB)',
    )
  })
})

describe('needsBrowser', () => {
  const page = (body: string) => `<html><body>${body}</body></html>`

  it('leaves a server-rendered page alone', () => {
    const html = page(`<main><p>${filler(100)}</p></main>`)
    expect(
      needsBrowser(200, html, markdownFromHtml(html, 'https://a.gov')),
    ).toBe(false)
  })

  it('renders a page that is only a JavaScript shell', () => {
    const html = page('<div id="root"></div><script src="/app.js"></script>')
    expect(
      needsBrowser(200, html, markdownFromHtml(html, 'https://a.gov')),
    ).toBe(true)
  })

  it('renders a page that says it needs JavaScript and has little else', () => {
    const html = page(
      `<noscript>Your Javascript is turned off</noscript><nav>${filler(200)}</nav><div>Loading...</div>`,
    )
    expect(
      needsBrowser(200, html, markdownFromHtml(html, 'https://a.gov')),
    ).toBe(true)
  })

  it('renders a bot challenge and a refused request', () => {
    const challenge = `<html><head><title>Just a moment...</title></head><body>${filler(100)}</body></html>`
    expect(needsBrowser(200, challenge, filler(100))).toBe(true)
    expect(needsBrowser(403, page(filler(100)), filler(100))).toBe(true)
  })
})

describe('documentKind', () => {
  it('knows a PDF by type or by its bytes, and a docx by type or name', () => {
    const pdf = Buffer.from('%PDF-1.7 ...')
    const zip = Buffer.from('PK\u0003\u0004...')
    expect(
      documentKind('application/pdf', Buffer.from(''), 'https://a.gov/x'),
    ).toBe('pdf')
    expect(
      documentKind('application/octet-stream', pdf, 'https://a.gov/x'),
    ).toBe('pdf')
    expect(
      documentKind('application/octet-stream', zip, 'https://a.gov/a.docx?v=1'),
    ).toBe('docx')
    expect(
      documentKind('text/html', Buffer.from('<html>'), 'https://a.gov/'),
    ).toBeUndefined()
  })
})

describe('documentPages', () => {
  it('reads a PDF page by page', async () => {
    const pdf = await pdfWithPages(['Call to order', 'Rezoning of 12 Main St'])
    expect(await documentPages('pdf', pdf)).toEqual([
      'Call to order',
      'Rezoning of 12 Main St',
    ])
  })

  it('reads a Word file in page-sized sections', async () => {
    const docx = await Packer.toBuffer(
      new Document({
        sections: [
          {
            children: [
              new Paragraph('Staff report'),
              new Paragraph(filler(400)),
            ],
          },
        ],
      }),
    )
    const pages = await documentPages('docx', docx)
    expect(pages.length).toBeGreaterThan(1)
    expect(pages[0]).toMatch(/^Staff report/)
  })
})
