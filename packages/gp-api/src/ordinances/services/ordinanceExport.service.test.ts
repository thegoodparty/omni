import { describe, expect, it } from 'vitest'
import { Ordinance } from '../../generated/prisma'
import { OrdinanceExportService } from './ordinanceExport.service'

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

  it('renders a valid Word document', async () => {
    const result = await service.render(record(), 'docx')

    expect(result.contentType).toContain('wordprocessingml.document')
    expect(result.filename).toBe('tree-canopy.docx')
    // .docx is a zip; zip files start with the PK magic marker.
    expect(result.buffer.subarray(0, 2).toString('ascii')).toBe('PK')
    expect(result.buffer.length).toBeGreaterThan(500)
  })

  it('renders without a quality report or sources', async () => {
    const bare = record({
      draftSources: null,
      qualityReport: null,
    } as Partial<Ordinance>)

    const pdf = await service.render(bare, 'pdf')
    const docx = await service.render(bare, 'docx')

    expect(pdf.buffer.subarray(0, 5).toString('ascii')).toBe('%PDF-')
    expect(docx.buffer.subarray(0, 2).toString('ascii')).toBe('PK')
  })
})
