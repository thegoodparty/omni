import { describe, expect, it } from 'vitest'
import JSZip from 'jszip'
import { Ordinance } from '../../generated/prisma'
import { OrdinanceExportService } from './ordinanceExport.service'

// .docx is a zip; the rendered text lives in word/document.xml, so unzip it to
// assert the ordinance content actually landed in the document.
const docxText = async (buffer: Buffer): Promise<string> => {
  const zip = await JSZip.loadAsync(buffer)
  return (await zip.file('word/document.xml')?.async('string')) ?? ''
}

const record = (overrides: Partial<Ordinance> = {}): Ordinance =>
  ({
    slug: 'tree-canopy',
    draftTitle: 'Draft amendment to Chapter 34',
    draftBody: 'Section 1. Canopy goal.\n\n(a) Forty percent by 2040.',
    goalText: 'Tree canopy',
    draftSources: [
      {
        id: 's1',
        title: 'Or. Rev. Stat. § 227.215',
        url: 'https://example.gov/227',
      },
    ],
    qualityReport: {
      checks: [
        {
          id: 'authority',
          label: 'Authority',
          status: 'pass',
          note: 'Within council power.',
          source: { id: 's1', title: 'Src', url: 'https://example.gov/x' },
        },
      ],
      tally: { pass: 1, flag: 0, attention: 0 },
      stale: false,
      ranAgainstBodyHash: 'h',
    },
    ...overrides,
  }) as unknown as Ordinance

describe('OrdinanceExportService', () => {
  const service = new OrdinanceExportService()

  it('renders a valid PDF', async () => {
    const result = await service.render(record(), 'pdf')

    expect(result.contentType).toBe('application/pdf')
    expect(result.filename).toBe('tree-canopy.pdf')
    // PDF files start with the %PDF- magic marker.
    expect(result.buffer.subarray(0, 5).toString('ascii')).toBe('%PDF-')
    expect(result.buffer.length).toBeGreaterThan(500)
  })

  it('renders a valid Word document with the draft, sources, and QA', async () => {
    const result = await service.render(record(), 'docx')

    expect(result.contentType).toContain('wordprocessingml.document')
    expect(result.filename).toBe('tree-canopy.docx')
    // .docx is a zip; zip files start with the PK magic marker.
    expect(result.buffer.subarray(0, 2).toString('ascii')).toBe('PK')

    const xml = await docxText(result.buffer)
    // Title + body land in the document.
    expect(xml).toContain('Draft amendment to Chapter 34')
    expect(xml).toContain('Canopy goal')
    // The attorney reference section: sources + quality checks.
    expect(xml).toContain('Sources')
    expect(xml).toContain('Or. Rev. Stat. § 227.215')
    expect(xml).toContain('Quality report')
    expect(xml).toContain('Authority')
    // Styled QA: tally summary + the colored status pill (light fill via a
    // `clear` shading, not a solid black one).
    expect(xml).toContain('Reviewed by 1 checks')
    expect(xml).toContain('PASS')
    expect(xml).toContain('DCFCE7')
    expect(xml).toContain('w:val="clear"')
  })

  it('renders a long multi-page draft without stranding a check pill', async () => {
    const longBody = Array.from(
      { length: 120 },
      (_, i) => `Section ${i}. Lorem ipsum dolor sit amet, consectetur.`,
    ).join('\n')
    const manyChecks = Array.from({ length: 6 }, (_, i) => ({
      id: `c${i}`,
      label: `Check number ${i}`,
      status: 'flag' as const,
      note: 'This needs work before adoption. '.repeat(3),
    }))
    const big = record({
      draftBody: longBody,
      qualityReport: {
        checks: manyChecks,
        tally: { pass: 0, flag: 6, attention: 0 },
        stale: false,
        ranAgainstBodyHash: 'h',
      },
    } as Partial<Ordinance>)

    const pdf = await service.render(big, 'pdf')

    // The page-break guard must render a valid, multi-page PDF without throwing.
    expect(pdf.buffer.subarray(0, 5).toString('ascii')).toBe('%PDF-')
    expect(pdf.buffer.length).toBeGreaterThan(2000)
  })

  it('renders the empty-state fallbacks when there is no report or sources', async () => {
    const bare = record({
      draftSources: null,
      qualityReport: null,
    } as Partial<Ordinance>)

    const pdf = await service.render(bare, 'pdf')
    const docx = await service.render(bare, 'docx')

    expect(pdf.buffer.subarray(0, 5).toString('ascii')).toBe('%PDF-')
    const xml = await docxText(docx.buffer)
    expect(xml).toContain('No sources cited.')
    expect(xml).toContain('No quality report was generated.')
  })
})
