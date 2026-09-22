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
  checkResultsFile,
  TOO_LARGE_MESSAGE,
  uploadBlocker,
} from '../lib/checkResultsFile'
import { ACCEPTED_HEADERS, type ParsedResultsCsv } from '../lib/parseResultsCsv'
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
  // Reading a file is async and the input stays enabled while it runs, so
  // picking A then B quickly leaves two reads in flight. Each read claims a
  // number and drops itself if a newer one has started, otherwise whichever
  // finishes last wins and the page can show B's name over A's bytes.
  const readIdRef = useRef(0)

  const [phase, setPhase] = useState<Phase>('idle')
  const [busy, setBusy] = useState(false)
  const [fileName, setFileName] = useState('')
  const [csv, setCsv] = useState('')
  const [parsed, setParsed] = useState<ParsedResultsCsv | null>(null)
  const [report, setReport] = useState<OutreachResultsParseReport | null>(null)
  const [error, setError] = useState<string | null>(null)

  const reset = () => {
    // Also abandons any read still in flight.
    readIdRef.current += 1
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
    const readId = (readIdRef.current += 1)
    setReport(null)
    setError(null)
    setPhase('idle')

    // Checked before reading as well as inside checkResultsFile, so a file
    // far too large is never pulled into memory to be rejected.
    if (file.size > MAX_RESULTS_FILE_BYTES) {
      setFileName(file.name)
      setCsv('')
      setParsed({ ok: false, error: TOO_LARGE_MESSAGE })
      return
    }

    const text = await file.text()
    // A newer file was picked while this one was being read. Drop it.
    if (readId !== readIdRef.current) return

    const result = checkResultsFile({ fileName: file.name, csv: text })
    setFileName(file.name)
    setCsv(text)
    setParsed(result)
    if (uploadBlocker(result) === null) setPhase('parsed')
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

  const blocker = parsed?.ok ? uploadBlocker(parsed) : null

  return (
    <Card>
      <Heading size="3" mb="1">
        Upload the results file
      </Heading>
      <Text size="2" color="gray" as="p">
        The CSV fulfilment produced, as it came out of the texting tool. Needs a
        phone column ({ACCEPTED_HEADERS.phone}), a message column (
        {ACCEPTED_HEADERS.content}) and a direction column (
        {ACCEPTED_HEADERS.sendDirection}) — only inbound rows are counted as
        replies. A timestamp column ({ACCEPTED_HEADERS.receivedAt}) is used if
        it is there.
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

          {blocker && (
            <Callout.Root color="red" mt="3">
              <Callout.Text>{blocker}</Callout.Text>
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
        {phase === 'parsed' && parsed?.ok && blocker === null && (
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
