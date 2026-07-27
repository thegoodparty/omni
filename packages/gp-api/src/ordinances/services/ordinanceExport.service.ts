import { Buffer } from 'buffer'
import { Injectable } from '@nestjs/common'
import { z } from 'zod'
import PDFDocument from 'pdfkit'
import {
  BorderStyle,
  Document,
  ExternalHyperlink,
  HeadingLevel,
  Packer,
  Paragraph,
  ShadingType,
  TabStopType,
  TextRun,
} from 'docx'
import {
  type OrdinanceQualityCheck,
  type OrdinanceQualityReport,
  type OrdinanceSource,
  ORDINANCE_DRAFT_DISCLAIMER,
  OrdinanceQualityReportSchema,
  OrdinanceSourceSchema,
} from '@goodparty_org/contracts'
import { Ordinance } from '../../generated/prisma'
import { OrdinanceExportFormat } from '../schemas/ordinances.schema'

// Status palette echoing the app's QC pills. Hex without '#' so docx can use it
// directly; the PDF renderer prepends '#'.
const STATUS_STYLE: Record<
  OrdinanceQualityCheck['status'],
  { label: string; text: string; bg: string }
> = {
  pass: { label: 'PASS', text: '15803D', bg: 'DCFCE7' },
  flag: { label: 'FLAG', text: 'B91C1C', bg: 'FEE2E2' },
  attention: { label: 'ATTENTION', text: 'B45309', bg: 'FEF3C7' },
}

const MUTED = '6B7280'
const NOTE = '333333'
const DIVIDER = 'E5E7EB'
const LINK = '1155CC'

type OrdinanceTally = OrdinanceQualityReport['tally']

type ExportContent = {
  title: string
  bodyLines: string[]
  sources: OrdinanceSource[]
  checks: OrdinanceQualityCheck[]
  tally: OrdinanceTally
  stale: boolean
}

const EMPTY_TALLY: OrdinanceTally = { pass: 0, flag: 0, attention: 0 }

// The QC summary line, shared by both renderers so its wording can't drift.
// Exported as a pure function so the singular/plural + counts + stale warning
// are unit-testable (both renderers embed it, and the PDF stream is compressed
// so its text can't be asserted from the raw buffer).
export const tallySummary = (
  checkCount: number,
  tally: OrdinanceTally,
  stale = false,
): string => {
  const noun = checkCount === 1 ? 'check' : 'checks'
  // Flag a report scored against an older draft so an attorney reader knows the
  // analysis may not reflect the current text (mirrors the app's stale banner).
  const warning = stale
    ? 'Results may be outdated — re-run the quality check. '
    : ''
  return (
    `${warning}Reviewed by ${checkCount} ${noun}    ` +
    `${tally.pass} pass · ${tally.flag} flag · ${tally.attention} attention`
  )
}

const sourceLabel = (source: OrdinanceSource): string =>
  source.publisher ? `${source.title} — ${source.publisher}` : source.title

const buildContent = (record: Ordinance): ExportContent => {
  const report = OrdinanceQualityReportSchema.safeParse(record.qualityReport)
  const sources = z.array(OrdinanceSourceSchema).safeParse(record.draftSources)
  return {
    title: record.draftTitle ?? record.goalText ?? 'Untitled ordinance',
    bodyLines: (record.draftBody ?? '').split('\n'),
    sources: sources.success ? sources.data : [],
    checks: report.success ? report.data.checks : [],
    // Reuse the persisted tally rather than recomputing it here.
    tally: report.success ? report.data.tally : EMPTY_TALLY,
    stale: report.success ? report.data.stale : false,
  }
}

// Whether a check row's header (label + pill) fits before the page's bottom
// margin. Extracted so the page-break decision is unit-testable; the pill is
// drawn at an absolute y, so a row that doesn't fit must start a new page.
// Reserve the taller of the pill and one label line (labels are the six fixed
// rubric strings, so a single line is the realistic case, but this stays
// correct if the label ever wraps).
export const checkRowHeaderFits = (
  currentY: number,
  pillHeight: number,
  bottomMargin: number,
  labelFontSize = 11,
): boolean =>
  currentY + Math.max(pillHeight, Math.ceil(labelFontSize * 1.2)) + 4 <=
  bottomMargin

export type OrdinanceExportResult = {
  buffer: Buffer
  filename: string
  contentType: string
}

@Injectable()
export class OrdinanceExportService {
  async render(
    record: Ordinance,
    format: OrdinanceExportFormat,
  ): Promise<OrdinanceExportResult> {
    const content = buildContent(record)
    if (format === 'docx') {
      return {
        buffer: await renderDocx(content),
        filename: `${record.slug}.docx`,
        contentType:
          'application/vnd.openxmlformats-officedocument' +
          '.wordprocessingml.document',
      }
    }
    return {
      buffer: await renderPdf(content),
      filename: `${record.slug}.pdf`,
      contentType: 'application/pdf',
    }
  }
}

// ── PDF ────────────────────────────────────────────────────────────────────

const renderPdf = (content: ExportContent): Promise<Buffer> => {
  const doc = new PDFDocument({ size: 'LETTER', margin: 54 })
  const chunks: Buffer[] = []
  doc.on('data', (chunk: Buffer) => chunks.push(chunk))
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)))
    // Without this, a pdfkit error would leave the promise pending and hang the
    // request until timeout (matches briefingPdf.renderer.ts).
    doc.on('error', reject)
  })

  const left = doc.page.margins.left
  const right = doc.page.width - doc.page.margins.right
  const contentW = right - left

  const rule = (): void => {
    const y = doc.y + 1
    doc
      .moveTo(left, y)
      .lineTo(right, y)
      .lineWidth(0.5)
      .strokeColor(`#${DIVIDER}`)
      .stroke()
    doc.moveDown(0.8)
  }

  const link = (label: string, url?: string): void => {
    if (url) {
      doc
        .fillColor(`#${LINK}`)
        .text(label, { link: url, underline: true })
        .fillColor('black')
    } else {
      doc.fillColor('black').text(label)
    }
  }

  doc.font('Helvetica-Bold').fontSize(18).fillColor('black').text(content.title)
  doc.moveDown()
  doc.font('Helvetica').fontSize(11).fillColor('black')
  for (const line of content.bodyLines) {
    if (line.trim().length === 0) doc.moveDown()
    else doc.text(line)
  }

  doc.addPage()

  // Review disclaimer at the top of the appendix. Kept off the ordinance body
  // pages so the legislative text stays clean.
  doc.font('Helvetica-Bold').fontSize(10.5).fillColor(`#${NOTE}`)
  doc.text(`${ORDINANCE_DRAFT_DISCLAIMER.lead} `, { continued: true })
  doc.font('Helvetica').text(ORDINANCE_DRAFT_DISCLAIMER.body)
  doc.fillColor('black')
  doc.moveDown(0.5)
  rule()
  doc.moveDown(0.2)

  // Sources
  doc.font('Helvetica-Bold').fontSize(14).fillColor('black').text('Sources')
  doc.moveDown(0.3)
  rule()
  doc.font('Helvetica').fontSize(10.5)
  if (content.sources.length === 0) {
    doc.fillColor(`#${MUTED}`).text('No sources cited.').fillColor('black')
  } else {
    for (const source of content.sources) {
      link(`• ${sourceLabel(source)}`, source.url)
      doc.moveDown(0.2)
    }
  }

  // Quality report
  doc.moveDown()
  doc
    .font('Helvetica-Bold')
    .fontSize(14)
    .fillColor('black')
    .text('Quality report')
  doc.moveDown(0.2)
  if (content.checks.length > 0) {
    doc
      .font('Helvetica')
      .fontSize(10)
      .fillColor(`#${MUTED}`)
      .text(tallySummary(content.checks.length, content.tally, content.stale))
      .fillColor('black')
  }
  doc.moveDown(0.3)
  rule()

  if (content.checks.length === 0) {
    doc
      .font('Helvetica')
      .fontSize(10.5)
      .fillColor(`#${MUTED}`)
      .text('No quality report was generated.')
      .fillColor('black')
  } else {
    for (const check of content.checks) {
      pdfCheckRow(doc, check, left, right, contentW, link)
    }
  }

  doc.end()
  return done
}

const pdfCheckRow = (
  doc: PDFKit.PDFDocument,
  check: OrdinanceQualityCheck,
  left: number,
  right: number,
  contentW: number,
  link: (label: string, url?: string) => void,
): void => {
  const style = STATUS_STYLE[check.status]
  const padX = 6
  const pillH = 14

  // Measure the pill at its own font before laying out the label beside it.
  doc.font('Helvetica-Bold').fontSize(8)
  const pillW = doc.widthOfString(style.label) + padX * 2
  const pillX = right - pillW

  // Keep the label and its pill on the same page. The pill is drawn at an
  // absolute y, so if the label line would overflow the page, pdfkit moves the
  // label to a new page while the pill stays behind — stranding it in the old
  // page's footer. Break first when the header line won't fit.
  const bottom = doc.page.height - doc.page.margins.bottom
  if (!checkRowHeaderFits(doc.y, pillH, bottom)) doc.addPage()

  const y0 = doc.y
  // Label on the left, leaving room for the pill on the right.
  doc
    .font('Helvetica-Bold')
    .fontSize(11)
    .fillColor('black')
    .text(check.label, left, y0, { width: contentW - pillW - 10 })
  const afterLabelY = doc.y

  // Pill on the right, top-aligned with the label.
  doc.roundedRect(pillX, y0, pillW, pillH, 7).fill(`#${style.bg}`)
  doc
    .font('Helvetica-Bold')
    .fontSize(8)
    .fillColor(`#${style.text}`)
    .text(style.label, pillX + padX, y0 + 3.5, { lineBreak: false })

  // The pill text left the cursor by the pill; return it below the label.
  doc.fillColor('black')
  doc.x = left
  doc.y = afterLabelY

  // Skip an empty note — text('') still advances a full line, leaving a gap.
  if (check.note) {
    doc
      .font('Helvetica')
      .fontSize(10.5)
      .fillColor(`#${NOTE}`)
      .text(check.note, { width: contentW })
    doc.fillColor('black')
  }

  if (check.source) {
    doc.font('Helvetica').fontSize(9.5)
    link(`source: ${sourceLabel(check.source)}`, check.source.url)
  }
  doc.moveDown(0.7)
}

// ── Word (.docx) ─────────────────────────────────────────────────────────────

const RIGHT_TAB = 9350

const docxDivider = (): Paragraph =>
  new Paragraph({
    spacing: { after: 120 },
    border: {
      bottom: { style: BorderStyle.SINGLE, size: 6, color: DIVIDER },
    },
    children: [],
  })

const docxSourceLine = (label: string, url?: string): Paragraph => {
  if (!url) return new Paragraph({ children: [new TextRun(label)] })
  return new Paragraph({
    children: [
      new ExternalHyperlink({
        children: [new TextRun({ text: label, style: 'Hyperlink' })],
        link: url,
      }),
    ],
  })
}

const docxCheckParagraphs = (check: OrdinanceQualityCheck): Paragraph[] => {
  const style = STATUS_STYLE[check.status]
  const paragraphs: Paragraph[] = [
    new Paragraph({
      spacing: { before: 160 },
      tabStops: [{ type: TabStopType.RIGHT, position: RIGHT_TAB }],
      children: [
        new TextRun({ text: check.label, bold: true }),
        new TextRun({ text: '\t' }),
        new TextRun({
          text: ` ${style.label} `,
          bold: true,
          size: 16,
          color: style.text,
          // CLEAR shows `fill` as the background; SOLID would fill with the
          // foreground `color` (auto=black), which reads as a black pill.
          shading: { type: ShadingType.CLEAR, color: 'auto', fill: style.bg },
        }),
      ],
    }),
  ]
  // Skip an empty note — an empty paragraph renders as a blank gap.
  if (check.note) {
    paragraphs.push(
      new Paragraph({
        children: [new TextRun({ text: check.note, color: NOTE })],
      }),
    )
  }
  if (check.source) {
    paragraphs.push(
      docxSourceLine(`source: ${sourceLabel(check.source)}`, check.source.url),
    )
  }
  return paragraphs
}

const renderDocx = (content: ExportContent): Promise<Buffer> => {
  const body: Paragraph[] = [
    new Paragraph({ text: content.title, heading: HeadingLevel.HEADING_1 }),
    ...content.bodyLines.map((line) => new Paragraph({ text: line })),
  ]

  // Review disclaimer at the top of the appendix page (carries the page break
  // so it, not Sources, opens the page). Kept off the ordinance body.
  const disclaimer: Paragraph[] = [
    new Paragraph({
      pageBreakBefore: true,
      spacing: { after: 80 },
      children: [
        new TextRun({
          text: `${ORDINANCE_DRAFT_DISCLAIMER.lead} `,
          bold: true,
          color: NOTE,
        }),
        new TextRun({ text: ORDINANCE_DRAFT_DISCLAIMER.body, color: NOTE }),
      ],
    }),
    docxDivider(),
  ]

  const sources: Paragraph[] = [
    new Paragraph({
      text: 'Sources',
      heading: HeadingLevel.HEADING_2,
    }),
    docxDivider(),
    ...(content.sources.length === 0
      ? [new Paragraph({ text: 'No sources cited.' })]
      : content.sources.map((s) =>
          docxSourceLine(`• ${sourceLabel(s)}`, s.url),
        )),
  ]

  const quality: Paragraph[] = [
    new Paragraph({
      text: 'Quality report',
      heading: HeadingLevel.HEADING_2,
      spacing: { before: 240 },
    }),
    ...(content.checks.length > 0
      ? [
          new Paragraph({
            children: [
              new TextRun({
                text: tallySummary(
                  content.checks.length,
                  content.tally,
                  content.stale,
                ),
                color: MUTED,
              }),
            ],
          }),
        ]
      : []),
    docxDivider(),
    ...(content.checks.length === 0
      ? [new Paragraph({ text: 'No quality report was generated.' })]
      : content.checks.flatMap(docxCheckParagraphs)),
  ]

  const doc = new Document({
    sections: [{ children: [...body, ...disclaimer, ...sources, ...quality] }],
  })
  return Packer.toBuffer(doc).then((data) => Buffer.from(data))
}
