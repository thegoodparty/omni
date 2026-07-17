import { Buffer } from 'buffer'
import { Injectable } from '@nestjs/common'
import { z } from 'zod'
import PDFDocument from 'pdfkit'
import {
  Document,
  ExternalHyperlink,
  HeadingLevel,
  Packer,
  Paragraph,
  TextRun,
} from 'docx'
import {
  type OrdinanceQualityCheck,
  type OrdinanceSource,
  OrdinanceQualityReportSchema,
  OrdinanceSourceSchema,
} from '@goodparty_org/contracts'
import { Ordinance } from '../../generated/prisma'
import { OrdinanceExportFormat } from '../schemas/ordinances.schema'

const LINK_COLOR = '#1155cc'

const STATUS_LABEL: Record<OrdinanceQualityCheck['status'], string> = {
  pass: 'Pass',
  flag: 'Flag',
  attention: 'Attention',
}

// The assembled document, format-agnostic, so the PDF and Word renderers stay
// in sync. The last section (sources + quality report) is the attorney-facing
// reference, with links to each source.
type ExportContent = {
  title: string
  bodyLines: string[]
  sources: OrdinanceSource[]
  checks: OrdinanceQualityCheck[]
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
  }
}

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

  doc.font('Helvetica-Bold').fontSize(18).fillColor('black')
  doc.text(content.title)
  doc.moveDown()
  doc.font('Helvetica').fontSize(11)
  for (const line of content.bodyLines) {
    // Empty lines are paragraph breaks in the source text; render a gap.
    if (line.trim().length === 0) doc.moveDown()
    else doc.text(line)
  }

  const pdfLink = (label: string, url?: string): void => {
    if (url) {
      doc
        .fillColor(LINK_COLOR)
        .text(label, { link: url, underline: true })
        .fillColor('black')
    } else {
      doc.text(label)
    }
  }

  doc.addPage()
  doc.font('Helvetica-Bold').fontSize(14).text('Sources')
  doc.moveDown(0.5).font('Helvetica').fontSize(11)
  if (content.sources.length === 0) {
    doc.fillColor('#666666').text('No sources cited.').fillColor('black')
  } else {
    for (const source of content.sources) {
      pdfLink(`• ${sourceLabel(source)}`, source.url)
    }
  }

  doc.moveDown().font('Helvetica-Bold').fontSize(14).text('Quality report')
  doc.moveDown(0.5).fontSize(11)
  if (content.checks.length === 0) {
    doc
      .font('Helvetica')
      .fillColor('#666666')
      .text('No quality report was generated.')
      .fillColor('black')
  } else {
    for (const check of content.checks) {
      doc
        .font('Helvetica-Bold')
        .text(`${check.label} — ${STATUS_LABEL[check.status]}`)
      doc.font('Helvetica').text(check.note)
      if (check.source)
        pdfLink(`Source: ${sourceLabel(check.source)}`, check.source.url)
      doc.moveDown(0.5)
    }
  }

  doc.end()
  return done
}

const docxLink = (label: string, url?: string): Paragraph => {
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

const renderDocx = (content: ExportContent): Promise<Buffer> => {
  const body: Paragraph[] = [
    new Paragraph({ text: content.title, heading: HeadingLevel.HEADING_1 }),
    ...content.bodyLines.map((line) => new Paragraph({ text: line })),
  ]

  const sources: Paragraph[] = [
    new Paragraph({
      text: 'Sources',
      heading: HeadingLevel.HEADING_2,
      pageBreakBefore: true,
    }),
    ...(content.sources.length === 0
      ? [new Paragraph({ text: 'No sources cited.' })]
      : content.sources.map((s) => docxLink(`• ${sourceLabel(s)}`, s.url))),
  ]

  const quality: Paragraph[] = [
    new Paragraph({ text: 'Quality report', heading: HeadingLevel.HEADING_2 }),
    ...(content.checks.length === 0
      ? [new Paragraph({ text: 'No quality report was generated.' })]
      : content.checks.flatMap((check) => [
          new Paragraph({
            children: [
              new TextRun({
                text: `${check.label} — ${STATUS_LABEL[check.status]}`,
                bold: true,
              }),
            ],
          }),
          new Paragraph({ text: check.note }),
          ...(check.source
            ? [
                docxLink(
                  `Source: ${sourceLabel(check.source)}`,
                  check.source.url,
                ),
              ]
            : []),
        ])),
  ]

  const doc = new Document({
    sections: [{ children: [...body, ...sources, ...quality] }],
  })
  return Packer.toBuffer(doc).then((data) => Buffer.from(data))
}
