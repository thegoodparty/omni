'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useQueryClient } from '@tanstack/react-query'
import {
  Button,
  Card,
  CardContent,
  CheckboxLabel,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Stepper,
} from '@styleguide'
import { clientRequest } from 'gpApi/typed-request'
import type { APIEndpoints } from 'gpApi/api-endpoints'

type ImportField =
  | 'firstName'
  | 'lastName'
  | 'address'
  | 'city'
  | 'zip'
  | 'phone'
  | 'email'
  | 'skip'

type ImportRow = APIEndpoints['POST /v1/poc/contacts/import']['Request']['rows'][number]
type ImportResult = APIEndpoints['POST /v1/poc/contacts/import']['Response']
type CommitResult =
  APIEndpoints['POST /v1/poc/contacts/import/:importId/commit']['Response']

const FIELD_OPTIONS: { value: ImportField; label: string }[] = [
  { value: 'firstName', label: 'First name' },
  { value: 'lastName', label: 'Last name' },
  { value: 'address', label: 'Street address' },
  { value: 'city', label: 'City' },
  { value: 'zip', label: 'ZIP' },
  { value: 'phone', label: 'Phone' },
  { value: 'email', label: 'Email' },
  { value: 'skip', label: 'Skip this column' },
]

const guessField = (header: string): ImportField => {
  const h = header.toLowerCase().replace(/[^a-z]/g, '')
  if (h.includes('first') || h === 'fname' || h === 'given') return 'firstName'
  if (h.includes('last') || h === 'lname' || h.includes('surname'))
    return 'lastName'
  if (h.includes('email') || h.includes('mail')) return 'email'
  if (h.includes('phone') || h.includes('mobile') || h.includes('cell'))
    return 'phone'
  if (h.includes('zip') || h.includes('postal')) return 'zip'
  if (h.includes('city') || h.includes('town')) return 'city'
  if (h.includes('address') || h.includes('street')) return 'address'
  return 'skip'
}

const parseCsv = (text: string): string[][] => {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let inQuotes = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (inQuotes) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"'
        i++
      } else if (ch === '"') {
        inQuotes = false
      } else {
        cell += ch
      }
    } else if (ch === '"') {
      inQuotes = true
    } else if (ch === ',') {
      row.push(cell)
      cell = ''
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++
      row.push(cell)
      rows.push(row)
      row = []
      cell = ''
    } else {
      cell += ch
    }
  }
  if (cell !== '' || row.length > 0) {
    row.push(cell)
    rows.push(row)
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ''))
}

const formatMs = (ms: number) =>
  ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`

const Timing = ({
  label,
  ms,
  serverMs,
}: {
  label: string
  ms: number
  serverMs?: Record<string, number>
}) => (
  <p className="text-xs text-muted-foreground">
    {label} took {formatMs(ms)}
    {serverMs
      ? ` (server: ${Object.entries(serverMs)
          .map(([k, v]) => `${k} ${formatMs(v)}`)
          .join(', ')})`
      : ''}
  </p>
)

type Step = 'file' | 'columns' | 'consent' | 'review' | 'done'
const STEP_ORDER: Step[] = ['file', 'columns', 'consent', 'review', 'done']

export const ImportContactsPocPage = () => {
  const queryClient = useQueryClient()
  const [step, setStep] = useState<Step>('file')
  const [fileName, setFileName] = useState<string | null>(null)
  const [headers, setHeaders] = useState<string[]>([])
  const [dataRows, setDataRows] = useState<string[][]>([])
  const [mapping, setMapping] = useState<ImportField[]>([])
  const [consent, setConsent] = useState(false)
  const [parseMs, setParseMs] = useState<number | null>(null)
  const [uploadMs, setUploadMs] = useState<number | null>(null)
  const [commitMs, setCommitMs] = useState<number | null>(null)
  const [isWorking, setIsWorking] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [importResult, setImportResult] = useState<ImportResult | null>(null)
  const [commitResult, setCommitResult] = useState<CommitResult | null>(null)
  const [sentRowLines, setSentRowLines] = useState<number[]>([])
  const [skippedCount, setSkippedCount] = useState(0)

  useEffect(() => {
    window.scrollTo(0, 0)
  }, [step])

  const handleFile = async (file: File) => {
    setError(null)
    const startedAt = performance.now()
    const text = await file.text()
    const parsed = parseCsv(text)
    setParseMs(Math.round(performance.now() - startedAt))
    const [headerRow, ...rest] = parsed
    if (!headerRow || rest.length === 0) {
      setError('That file has no rows under the header.')
      return
    }
    setFileName(file.name)
    setHeaders(headerRow)
    setDataRows(rest)
    setMapping(headerRow.map(guessField))
  }

  const buildRows = () => {
    const rows: ImportRow[] = []
    const lines: number[] = []
    dataRows.forEach((cells, index) => {
      const row: Partial<Record<ImportField, string>> = {}
      mapping.forEach((field, col) => {
        const value = cells[col]?.trim()
        if (field === 'skip' || !value) return
        row[field] = row[field] ? `${row[field]} ${value}` : value
      })
      if (!row.firstName || !row.lastName) return
      rows.push({
        firstName: row.firstName,
        lastName: row.lastName,
        address: row.address,
        city: row.city,
        zip: row.zip,
        phone: row.phone,
        email: row.email,
      })
      lines.push(index + 2)
    })
    return { rows, lines }
  }

  const handleUpload = async () => {
    const { rows, lines } = buildRows()
    if (rows.length === 0) {
      setError('No rows have both a first and last name.')
      return
    }
    setError(null)
    setIsWorking(true)
    const startedAt = performance.now()
    try {
      const res = await clientRequest('POST /v1/poc/contacts/import', { rows })
      setUploadMs(Math.round(performance.now() - startedAt))
      setImportResult(res.data)
      setSentRowLines(lines)
      setSkippedCount(dataRows.length - rows.length)
      setStep('review')
    } catch {
      setError("We couldn't upload that file. Try again.")
    } finally {
      setIsWorking(false)
    }
  }

  const handleCommit = async () => {
    if (!importResult) return
    setError(null)
    setIsWorking(true)
    const startedAt = performance.now()
    try {
      const res = await clientRequest(
        'POST /v1/poc/contacts/import/:importId/commit',
        { importId: importResult.importId },
      )
      setCommitMs(Math.round(performance.now() - startedAt))
      setCommitResult(res.data)
      await queryClient.invalidateQueries()
      setStep('done')
    } catch {
      setError("We couldn't add them. Try again.")
    } finally {
      setIsWorking(false)
    }
  }

  const mapped = new Set(mapping)
  const hasNames = mapped.has('firstName') && mapped.has('lastName')

  return (
    <div className="mx-auto mt-8 flex w-full max-w-[560px] flex-col gap-6 pb-24">
      <Stepper
        currentStep={STEP_ORDER.indexOf(step) + 1}
        totalSteps={STEP_ORDER.length}
        overline="Import contacts"
      />

      {step === 'file' && (
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            <h1 className="text-lg font-semibold">
              Which file has your contacts?
            </h1>
            <p className="text-sm text-muted-foreground">
              Choose a CSV file with a header row.
            </p>
          </div>
          <input
            type="file"
            accept=".csv,text/csv"
            aria-label="CSV file"
            className="text-sm"
            onChange={(e) => {
              const file = e.target.files?.[0]
              if (file) handleFile(file)
            }}
          />
          {fileName && (
            <p className="text-sm">
              {fileName}: {dataRows.length} rows, {headers.length} columns
            </p>
          )}
          {parseMs !== null && <Timing label="Reading the file" ms={parseMs} />}
          <div className="flex justify-between">
            <Button variant="outline" asChild>
              <Link href="/dashboard/contacts">Cancel</Link>
            </Button>
            <Button
              disabled={dataRows.length === 0}
              onClick={() => setStep('columns')}
            >
              Continue
            </Button>
          </div>
        </div>
      )}

      {step === 'columns' && (
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            <h1 className="text-lg font-semibold">Which column is which?</h1>
            <p className="text-sm text-muted-foreground">
              We guessed from your headers. First and last name are required.
            </p>
          </div>
          <Card>
            <CardContent className="flex flex-col gap-3 pt-6">
              {headers.map((header, col) => (
                <div
                  key={`${header}-${col}`}
                  className="grid grid-cols-2 items-center gap-4"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">
                      {header || `Column ${col + 1}`}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      {dataRows[0]?.[col] ?? ''}
                    </p>
                  </div>
                  <Select
                    value={mapping[col] ?? 'skip'}
                    onValueChange={(value) =>
                      setMapping((current) =>
                        current.map((f, i) =>
                          i === col ? (value as ImportField) : f,
                        ),
                      )
                    }
                  >
                    <SelectTrigger
                      className="w-full"
                      aria-label={`Field for ${header}`}
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {FIELD_OPTIONS.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ))}
            </CardContent>
          </Card>
          <div className="flex justify-between">
            <Button variant="outline" onClick={() => setStep('file')}>
              Back
            </Button>
            <Button disabled={!hasNames} onClick={() => setStep('consent')}>
              Continue
            </Button>
          </div>
        </div>
      )}

      {step === 'consent' && (
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            <h1 className="text-lg font-semibold">
              Did these people agree to hear from you?
            </h1>
            <p className="text-sm text-muted-foreground">
              Only import people who said you can contact them.
            </p>
          </div>
          <CheckboxLabel
            id="import-consent"
            label="These people agreed to hear from me"
            checked={consent}
            onCheckedChange={(checked) => setConsent(checked === true)}
          />
          {error && <p className="text-sm text-destructive">{error}</p>}
          <div className="flex justify-between">
            <Button
              variant="outline"
              disabled={isWorking}
              onClick={() => setStep('columns')}
            >
              Back
            </Button>
            <Button
              disabled={!consent}
              loading={isWorking}
              onClick={handleUpload}
            >
              Upload {dataRows.length} people
            </Button>
          </div>
          {isWorking && (
            <p className="text-xs text-muted-foreground">
              Checking them against the people we have. This can take 15
              seconds.
            </p>
          )}
        </div>
      )}

      {step === 'review' && importResult && (
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            <h1 className="text-lg font-semibold">
              Here&apos;s what we found in your file
            </h1>
            <p className="text-sm text-muted-foreground">
              {importResult.counts.total} people ready to add.
              {skippedCount > 0
                ? ` ${skippedCount} rows had no name and were left out.`
                : ''}
            </p>
          </div>
          <Card>
            <CardContent className="flex flex-col gap-4 pt-6">
              <div className="flex items-baseline justify-between gap-4">
                <p className="text-sm font-medium">
                  Adds details to people we have
                </p>
                <p className="text-lg font-semibold">
                  {importResult.counts.matched}
                </p>
              </div>
              <div className="flex items-baseline justify-between gap-4 border-t border-border pt-4">
                <p className="text-sm font-medium">New people</p>
                <p className="text-lg font-semibold">
                  {importResult.counts.new}
                </p>
              </div>
              <div className="flex flex-col gap-1 border-t border-border pt-4">
                <div className="flex items-baseline justify-between gap-4">
                  <p className="text-sm font-medium">Needs your eye</p>
                  <p className="text-lg font-semibold">
                    {importResult.counts.ambiguous}
                  </p>
                </div>
                {importResult.ambiguous.length > 0 && (
                  <>
                    <p className="text-sm text-muted-foreground">
                      These rows look like more than one person we have.
                      For now we&apos;ll add them as new people.
                    </p>
                    <ul className="text-sm">
                      {importResult.ambiguous.map((row) => (
                        <li key={row.rowIndex}>
                          Row {sentRowLines[row.rowIndex] ?? row.rowIndex + 1}:{' '}
                          {row.candidateCount} possible matches
                        </li>
                      ))}
                    </ul>
                  </>
                )}
              </div>
            </CardContent>
          </Card>
          {uploadMs !== null && (
            <Timing
              label="Upload and matching"
              ms={uploadMs}
              serverMs={importResult.timingsMs}
            />
          )}
          {error && <p className="text-sm text-destructive">{error}</p>}
          <div className="flex justify-between">
            <Button variant="outline" disabled={isWorking} asChild>
              <Link href="/dashboard/contacts">Cancel</Link>
            </Button>
            <Button loading={isWorking} onClick={handleCommit}>
              Add them
            </Button>
          </div>
        </div>
      )}

      {step === 'done' && commitResult && (
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            <h1 className="text-lg font-semibold">
              {commitResult.counts.people} people added
            </h1>
            <p className="text-sm text-muted-foreground">
              They&apos;re in your contacts now.
            </p>
          </div>
          {commitMs !== null && (
            <Timing
              label="Adding them"
              ms={commitMs}
              serverMs={commitResult.timingsMs}
            />
          )}
          <div>
            <Button asChild>
              <Link href="/dashboard/contacts">Go to contacts</Link>
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
