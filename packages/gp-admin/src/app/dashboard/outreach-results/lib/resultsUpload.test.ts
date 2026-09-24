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
  outboundRows: 0,
  matched: 328,
  unmatched: 12,
  optOuts: 9,
  committed: false,
  ...overrides,
})

const input = {
  kind: 'sms' as const,
  id: '42',
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

    expect(uploader.upload).toHaveBeenCalledWith('sms', '42', {
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
    expect(uploader.upload.mock.calls[0][2].dryRun).toBe(true)
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

    expect(uploader.upload).toHaveBeenCalledWith('sms', '42', {
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

  // A poll's file is forwarded to the analysis pipeline rather than
  // ingested, so there is no recipient map to match against and no opt-out
  // predicate run. Those counts come back null, and naming them anyway
  // would tell the operator something this upload never established.
  it('omits the counts a poll upload cannot establish', () => {
    expect(
      describeReport(
        report({
          rowsParsed: 41,
          outboundRows: 0,
          matched: null,
          unmatched: null,
          optOuts: null,
        })
      )
    ).toBe('41 rows')
  })

  it('still names the outbound rows on a poll', () => {
    expect(
      describeReport(
        report({
          rowsParsed: 41,
          outboundRows: 1200,
          matched: null,
          unmatched: null,
          optOuts: null,
        })
      )
    ).toBe('41 rows, 1,200 outbound')
  })

  // Zero is a real answer and null is the absence of one. A send that
  // matched nobody must still say so rather than falling silent the way a
  // poll does.
  it('keeps a zero count, which is not the same as no count', () => {
    expect(
      describeReport(
        report({ rowsParsed: 3, matched: 0, unmatched: 3, optOuts: 0 })
      )
    ).toBe('3 rows, 0 matched a recipient, 3 matched nobody, 0 opt-outs')
  })
})
