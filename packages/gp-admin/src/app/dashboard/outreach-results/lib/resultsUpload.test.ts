import { describe, it, expect, vi } from 'vitest'
import type { OutreachResultsParseReport } from '@goodparty_org/contracts'
import {
  commitResults,
  describeReport,
  requestParseReport,
  type ResultsUploader,
} from './resultsUpload'

const report = (
  overrides: Partial<OutreachResultsParseReport> = {}
): OutreachResultsParseReport => ({
  rowsParsed: 340,
  matched: 328,
  unmatched: 12,
  optOuts: 9,
  committed: false,
  ...overrides,
})

const input = {
  outreachId: 42,
  fileName: 'results.csv',
  csv: 'phone_number,message_text,send_direction\n5551234567,Hi,INBOUND\n',
  sourceLabel: 'gp-admin upload by staff@goodparty.org',
}

const uploaderReturning = (
  value: OutreachResultsParseReport
): ResultsUploader & { upload: ReturnType<typeof vi.fn> } => ({
  upload: vi.fn(async () => value),
})

describe('requestParseReport', () => {
  it('asks for a dry run and returns the report', async () => {
    const uploader = uploaderReturning(report())
    const result = await requestParseReport(uploader, input)

    expect(uploader.upload).toHaveBeenCalledWith(42, {
      fileName: 'results.csv',
      csv: input.csv,
      sourceLabel: input.sourceLabel,
      dryRun: true,
    })
    expect(result).toEqual(report())
  })

  it('never sends dryRun false, whatever the caller does next', async () => {
    const uploader = uploaderReturning(report())
    await requestParseReport(uploader, input)
    expect(uploader.upload.mock.calls[0][1].dryRun).toBe(true)
  })

  // The failure this page exists to prevent is a write nobody was told
  // about. A dry run that reports itself committed is exactly that.
  it('throws if the server says a dry run committed', async () => {
    const uploader = uploaderReturning(report({ committed: true }))
    await expect(requestParseReport(uploader, input)).rejects.toThrow(
      /committed a dry run/i
    )
  })
})

describe('commitResults', () => {
  it('sends dryRun false and returns the committed report', async () => {
    const uploader = uploaderReturning(report({ committed: true }))
    const result = await commitResults(uploader, input)

    expect(uploader.upload).toHaveBeenCalledWith(42, {
      fileName: 'results.csv',
      csv: input.csv,
      sourceLabel: input.sourceLabel,
      dryRun: false,
    })
    expect(result.committed).toBe(true)
  })

  it('throws if the server does not confirm the write', async () => {
    const uploader = uploaderReturning(report({ committed: false }))
    await expect(commitResults(uploader, input)).rejects.toThrow(
      /did not confirm/i
    )
  })
})

describe('describeReport', () => {
  it('reads the way the operator needs to hear it', () => {
    expect(describeReport(report())).toBe(
      '340 rows, 328 matched a recipient, 12 matched nobody, 9 opt-outs'
    )
  })

  it('does not pluralize a single row or opt-out', () => {
    expect(
      describeReport(
        report({ rowsParsed: 1, matched: 1, unmatched: 0, optOuts: 1 })
      )
    ).toBe('1 row, 1 matched a recipient, 0 matched nobody, 1 opt-out')
  })
})
