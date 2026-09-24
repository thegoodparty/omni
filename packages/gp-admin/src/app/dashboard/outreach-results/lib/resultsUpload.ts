import type {
  ResultsInboxKind,
  OutreachResultsParseReport,
} from '@goodparty_org/contracts'
import type { OutreachResultsUploadRequest } from '../types'

// Report before committing, in two calls that differ by one flag.
//
// The reason this is a separate step rather than a confirmation dialog: the
// interesting number is `unmatched`, and nothing on the page can know it. It
// needs the recipient map for this send. So the operator gets the real server
// answer, on the real file, before anything is written — which is the whole
// point of replacing the `aws s3 cp` line this page exists to retire.

export interface ResultsUploader {
  upload(
    kind: ResultsInboxKind,
    id: string,
    input: OutreachResultsUploadRequest
  ): Promise<OutreachResultsParseReport>
}

export interface ResultsUploadInput {
  kind: ResultsInboxKind
  id: string
  fileName: string
  csv: string
  sourceLabel: string
}

// A dry run that comes back `committed: true` means the flag was ignored
// somewhere between here and the database. Fail loudly rather than tell the
// operator nothing happened while rows were written.
export async function requestParseReport(
  uploader: ResultsUploader,
  { kind, id, fileName, csv, sourceLabel }: ResultsUploadInput
): Promise<OutreachResultsParseReport> {
  const report = await uploader.upload(kind, id, {
    fileName,
    csv,
    sourceLabel,
    dryRun: true,
  })
  if (report.committed) {
    throw new Error(
      'The server committed a dry run. Nothing was supposed to be written — ' +
        'stop and report this before uploading anything else.'
    )
  }
  return report
}

export async function commitResults(
  uploader: ResultsUploader,
  { kind, id, fileName, csv, sourceLabel }: ResultsUploadInput
): Promise<OutreachResultsParseReport> {
  const report = await uploader.upload(kind, id, {
    fileName,
    csv,
    sourceLabel,
    dryRun: false,
  })
  if (!report.committed) {
    throw new Error(
      'The server did not confirm the results were saved. Check the send ' +
        'before uploading again.'
    )
  }
  return report
}

export function describeReport(report: OutreachResultsParseReport): string {
  const plural = (count: number, word: string) =>
    `${count.toLocaleString()} ${word}${count === 1 ? '' : 's'}`
  // matched / unmatched / optOuts are null for a poll: its file is
  // forwarded to the analysis pipeline rather than ingested here, so there
  // is no recipient map to match against and no opt-out predicate run. The
  // summary names only what this upload actually established.
  const parts = [plural(report.rowsParsed, 'row')]
  if (report.outboundRows > 0) {
    parts.push(`${report.outboundRows.toLocaleString()} outbound`)
  }
  if (report.matched !== null) {
    parts.push(`${report.matched.toLocaleString()} matched a recipient`)
  }
  if (report.unmatched !== null) {
    parts.push(`${report.unmatched.toLocaleString()} matched nobody`)
  }
  if (report.optOuts !== null) {
    parts.push(plural(report.optOuts, 'opt-out'))
  }
  return parts.join(', ')
}
