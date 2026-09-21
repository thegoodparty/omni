'use client'

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  Badge,
  Box,
  Button,
  Callout,
  Card,
  DataList,
  Flex,
  Heading,
  Text,
} from '@radix-ui/themes'
import type { OutreachResultsParseReport } from '@goodparty_org/contracts'
import { useToast } from '@/components/Toast'
import { commitResultsUpload, dryRunResultsUpload } from '../actions'
import {
  ACCEPTED_HEADERS,
  parseResultsCsv,
  type ParsedResultsCsv,
} from '../lib/parseResultsCsv'
import { describeReport } from '../lib/resultsUpload'
import { MAX_RESULTS_FILE_BYTES } from '../types'

interface ResultsUploaderProps {
  outreachId: number
  /** What the operator is about to write results against, for the confirm copy. */
  sendLabel: string
}

type Phase = 'idle' | 'parsed' | 'reported' | 'committed'

const SKIPPED_SHOWN = 5

export function ResultsUploader({
  outreachId,
  sendLabel,
}: ResultsUploaderProps) {
  const router = useRouter()
  const { showToast } = useToast()
  const inputRef = useRef<HTMLInputElement>(null)

  const [phase, setPhase] = useState<Phase>('idle')
  const [busy, setBusy] = useState(false)
  const [fileName, setFileName] = useState('')
  const [csv, setCsv] = useState('')
  const [parsed, setParsed] = useState<ParsedResultsCsv | null>(null)
  const [report, setReport] = useState<OutreachResultsParseReport | null>(null)
  const [error, setError] = useState<string | null>(null)

  const reset = () => {
    setPhase('idle')
    setFileName('')
    setCsv('')
    setParsed(null)
    setReport(null)
    setError(null)
    if (inputRef.current) inputRef.current.value = ''
  }

  async function handleFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file) return
    setReport(null)
    setError(null)
    setPhase('idle')

    if (file.size > MAX_RESULTS_FILE_BYTES) {
      setParsed(null)
      setError('That file is larger than 5MB. Check it is the results CSV.')
      return
    }

    const text = await file.text()
    const result = parseResultsCsv(text)
    setFileName(file.name)
    setCsv(text)
    setParsed(result)
    if (result.ok) setPhase('parsed')
  }

  async function handleDryRun() {
    setBusy(true)
    setError(null)
    try {
      const next = await dryRunResultsUpload({ outreachId, fileName, csv })
      setReport(next)
      setPhase('reported')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not check the file')
    } finally {
      setBusy(false)
    }
  }

  async function handleCommit() {
    setBusy(true)
    setError(null)
    try {
      const next = await commitResultsUpload({ outreachId, fileName, csv })
      setReport(next)
      setPhase('committed')
      showToast(`Results saved — ${describeReport(next)}`)
      router.refresh()
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Could not save the results'
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card>
      <Heading size="3" mb="1">
        Upload the results file
      </Heading>
      <Text size="2" color="gray" as="p">
        The CSV fulfilment produced, as it came out of the texting tool. Needs a
        phone column ({ACCEPTED_HEADERS.phone}) and a message column (
        {ACCEPTED_HEADERS.content}). A timestamp column ({' '}
        {ACCEPTED_HEADERS.receivedAt}) is used if it is there.
      </Text>

      <Box mt="3">
        <input
          ref={inputRef}
          type="file"
          accept=".csv,text/csv"
          onChange={handleFile}
          disabled={busy}
          aria-label="Results CSV"
        />
      </Box>

      {parsed && !parsed.ok && (
        <Callout.Root color="red" mt="3">
          <Callout.Text>{parsed.error}</Callout.Text>
        </Callout.Root>
      )}

      {parsed?.ok && (
        <Box mt="3">
          <DataList.Root size="2">
            <DataList.Item>
              <DataList.Label>File</DataList.Label>
              <DataList.Value>{fileName}</DataList.Value>
            </DataList.Item>
            <DataList.Item>
              <DataList.Label>Rows read</DataList.Label>
              <DataList.Value>
                {parsed.rows.length.toLocaleString()} of{' '}
                {parsed.dataRows.toLocaleString()}
              </DataList.Value>
            </DataList.Item>
            <DataList.Item>
              <DataList.Label>Columns</DataList.Label>
              <DataList.Value>
                <Flex direction="column">
                  <Text size="2">phone ← {parsed.columns.phone}</Text>
                  <Text size="2">message ← {parsed.columns.content}</Text>
                  <Text size="2">
                    received ←{' '}
                    {parsed.columns.receivedAt ??
                      'not in this file, defaults to upload time'}
                  </Text>
                </Flex>
              </DataList.Value>
            </DataList.Item>
          </DataList.Root>

          {parsed.skipped.length > 0 && (
            <Callout.Root color="amber" mt="3">
              <Callout.Text>
                {parsed.skipped.length.toLocaleString()} row
                {parsed.skipped.length === 1 ? '' : 's'} could not be read and
                will not be uploaded:{' '}
                {parsed.skipped
                  .slice(0, SKIPPED_SHOWN)
                  .map((row) => `line ${row.line} (${row.reason})`)
                  .join(', ')}
                {parsed.skipped.length > SKIPPED_SHOWN ? ', …' : ''}
              </Callout.Text>
            </Callout.Root>
          )}

          {parsed.rows.length === 0 && (
            <Callout.Root color="red" mt="3">
              <Callout.Text>
                No usable rows in that file. Nothing to upload.
              </Callout.Text>
            </Callout.Root>
          )}
        </Box>
      )}

      {report && (
        <Callout.Root
          color={
            phase === 'committed'
              ? 'green'
              : report.unmatched > 0
                ? 'amber'
                : 'blue'
          }
          mt="3"
        >
          <Callout.Text>
            <strong>{describeReport(report)}</strong>
            {phase === 'committed' ? (
              <> — saved to {sendLabel}.</>
            ) : report.unmatched > 0 ? (
              <>
                {' '}
                — {report.unmatched.toLocaleString()} of these replies came from
                a number that was not on this send. They will not be attributed
                to anyone. Check you have the right file before saving.
              </>
            ) : (
              <> — nothing has been saved yet.</>
            )}
          </Callout.Text>
        </Callout.Root>
      )}

      {error && (
        <Callout.Root color="red" mt="3">
          <Callout.Text>{error}</Callout.Text>
        </Callout.Root>
      )}

      <Flex gap="3" mt="4" align="center">
        {phase === 'parsed' && parsed?.ok && parsed.rows.length > 0 && (
          <Button onClick={handleDryRun} disabled={busy} loading={busy}>
            Check this file against the send
          </Button>
        )}
        {phase === 'reported' && (
          <>
            <Button
              color="green"
              onClick={handleCommit}
              disabled={busy}
              loading={busy}
            >
              Save {report?.rowsParsed.toLocaleString() ?? 0} rows to this send
            </Button>
            <Button variant="soft" color="gray" onClick={reset} disabled={busy}>
              Use a different file
            </Button>
          </>
        )}
        {phase === 'committed' && (
          <>
            <Badge color="green" size="2">
              Results saved
            </Badge>
            <Button variant="soft" color="gray" onClick={reset}>
              Upload another file
            </Button>
          </>
        )}
      </Flex>
    </Card>
  )
}
