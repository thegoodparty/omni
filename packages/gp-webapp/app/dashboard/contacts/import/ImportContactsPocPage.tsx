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

type ImportRow =
  APIEndpoints['POST /v1/poc/contacts/imports']['Request']['rows'][number]
type ImportResult = APIEndpoints['POST /v1/poc/contacts/imports']['Response']
type AmbiguousPage =
  APIEndpoints['GET /v1/poc/contacts/imports/:importId/ambiguous']['Response']
type CommitResult =
  APIEndpoints['POST /v1/poc/contacts/imports/:importId/commit']['Response']

const REVIEW_PAGE_SIZE = 5

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

const joinParts = (parts: (string | number | null | undefined)[]) =>
  parts.filter((p) => p !== null && p !== undefined && p !== '').join(', ')

type Step = 'file' | 'columns' | 'consent' | 'summary' | 'review' | 'done'
const STEP_ORDER: Step[] = [
  'file',
  'columns',
  'consent',
  'summary',
  'review',
  'done',
]

export const ImportContactsPocPage = () => {
  const queryClient = useQueryClient()
  const [step, setStep] = useState<Step>('file')
  const [fileName, setFileName] = useState<string | null>(null)
  const [headers, setHeaders] = useState<string[]>([])
  const [dataRows, setDataRows] = useState<string[][]>([])
  const [mapping, setMapping] = useState<ImportField[]>([])
  const [consent, setConsent] = useState(false)
  const [isWorking, setIsWorking] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [uploadMs, setUploadMs] = useState<number | null>(null)
  const [importResult, setImportResult] = useState<ImportResult | null>(null)
  const [leftOut, setLeftOut] = useState(0)
  const [reviewPage, setReviewPage] = useState(1)
  const [ambiguous, setAmbiguous] = useState<AmbiguousPage | null>(null)
  const [savingRow, setSavingRow] = useState<number | null>(null)
  const [lastSaveMs, setLastSaveMs] = useState<number | null>(null)
  const [commitMs, setCommitMs] = useState<number | null>(null)
  const [commitResult, setCommitResult] = useState<CommitResult | null>(null)

  useEffect(() => {
    window.scrollTo(0, 0)
  }, [step, reviewPage])

  const handleFile = async (file: File) => {
    setError(null)
    const parsed = parseCsv(await file.text())
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

  const buildRows = (): ImportRow[] =>
    dataRows.flatMap((cells) => {
      const row: Partial<Record<ImportField, string>> = {}
      mapping.forEach((field, col) => {
        const value = cells[col]?.trim()
        if (field === 'skip' || !value) return
        row[field] = row[field] ? `${row[field]} ${value}` : value
      })
      if (!row.firstName || !row.lastName) return []
      return [
        {
          firstName: row.firstName,
          lastName: row.lastName,
          email: row.email,
          phone: row.phone,
          address: row.address,
          city: row.city,
          zip: row.zip,
        },
      ]
    })

  const loadReviewPage = async (importId: string, page: number) => {
    const res = await clientRequest(
      'GET /v1/poc/contacts/imports/:importId/ambiguous',
      { importId, page, pageSize: REVIEW_PAGE_SIZE },
    )
    setAmbiguous(res.data)
    setReviewPage(page)
  }

  const handleUpload = async () => {
    const rows = buildRows()
    if (rows.length === 0) {
      setError('No rows have both a first and last name.')
      return
    }
    setError(null)
    setIsWorking(true)
    const startedAt = performance.now()
    try {
      const res = await clientRequest('POST /v1/poc/contacts/imports', {
        fileName: fileName ?? 'contacts.csv',
        consentAffirmed: true,
        rows,
      })
      setUploadMs(Math.round(performance.now() - startedAt))
      setImportResult(res.data)
      setLeftOut(dataRows.length - rows.length)
      setStep('summary')
    } catch {
      setError("We couldn't upload that file. Try again.")
    } finally {
      setIsWorking(false)
    }
  }

  const handleStartReview = async () => {
    if (!importResult) return
    setError(null)
    setIsWorking(true)
    try {
      await loadReviewPage(importResult.importId, 1)
      setStep('review')
    } catch {
      setError("We couldn't load the matches. Try again.")
    } finally {
      setIsWorking(false)
    }
  }

  const handleResolve = async (
    rowIndex: number,
    choice: { resolution: 'link'; personId: string } | { resolution: 'skip' },
  ) => {
    if (!importResult) return
    setError(null)
    setSavingRow(rowIndex)
    const startedAt = performance.now()
    try {
      const res = await clientRequest(
        'PUT /v1/poc/contacts/imports/:importId/rows/:rowIndex/resolution',
        {
          importId: importResult.importId,
          rowIndex: String(rowIndex),
          ...choice,
        },
      )
      setLastSaveMs(Math.round(performance.now() - startedAt))
      setAmbiguous((current) =>
        current
          ? {
              ...current,
              rows: current.rows.map((row) =>
                row.rowIndex === rowIndex
                  ? {
                      ...row,
                      resolution: res.data.resolution,
                      resolvedPersonId: res.data.resolvedPersonId,
                    }
                  : row,
              ),
            }
          : current,
      )
    } catch {
      setError("We couldn't save that choice. Try again.")
    } finally {
      setSavingRow(null)
    }
  }

  const handleChangePage = async (page: number) => {
    if (!importResult) return
    setIsWorking(true)
    try {
      await loadReviewPage(importResult.importId, page)
    } catch {
      setError("We couldn't load the matches. Try again.")
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
        'POST /v1/poc/contacts/imports/:importId/commit',
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
  const totalReviewPages = ambiguous
    ? Math.max(1, Math.ceil(ambiguous.total / ambiguous.pageSize))
    : 1

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
          {error && <p className="text-sm text-destructive">{error}</p>}
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
                          i === col
                            ? (FIELD_OPTIONS.find((o) => o.value === value)
                                ?.value ?? 'skip')
                            : f,
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
              Upload
            </Button>
          </div>
        </div>
      )}

      {step === 'summary' && importResult && (
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            <h1 className="text-lg font-semibold">
              Ready to check your matches?
            </h1>
            <p className="text-sm text-muted-foreground">
              {importResult.counts.total} people in your file.
              {leftOut > 0
                ? ` ${leftOut} ${leftOut === 1 ? 'row' : 'rows'} had no first or last name and ${leftOut === 1 ? 'was' : 'were'} left out.`
                : ''}
            </p>
          </div>
          <Card>
            <CardContent className="flex flex-col gap-4 pt-6">
              <div className="flex items-baseline justify-between gap-4">
                <p className="text-sm font-medium">One match in your area</p>
                <p className="text-lg font-semibold">
                  {importResult.counts.matched}
                </p>
              </div>
              <div className="flex items-baseline justify-between gap-4 border-t border-border pt-4">
                <p className="text-sm font-medium">More than one match</p>
                <p className="text-lg font-semibold">
                  {importResult.counts.ambiguous}
                </p>
              </div>
              <div className="flex items-baseline justify-between gap-4 border-t border-border pt-4">
                <p className="text-sm font-medium">No match</p>
                <p className="text-lg font-semibold">
                  {importResult.counts.unmatched}
                </p>
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
            {importResult.counts.ambiguous > 0 ? (
              <Button loading={isWorking} onClick={handleStartReview}>
                Review matches
              </Button>
            ) : (
              <Button loading={isWorking} onClick={handleCommit}>
                Add them
              </Button>
            )}
          </div>
        </div>
      )}

      {step === 'review' && ambiguous && (
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            <h1 className="text-lg font-semibold">Which person is this?</h1>
            <p className="text-sm text-muted-foreground">
              Pick a match or choose none. People you leave are added as
              unverified.
            </p>
          </div>
          {ambiguous.rows.map((row) => (
            <Card key={row.rowIndex}>
              <CardContent className="flex flex-col gap-3 pt-6">
                <div>
                  <p className="text-sm font-semibold">
                    {row.firstName} {row.lastName}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    From your file:{' '}
                    {joinParts([row.address, row.city, row.zip]) ||
                      'no address'}
                  </p>
                </div>
                <div className="flex flex-col gap-2">
                  {row.candidates.map((candidate) => {
                    const selected =
                      row.resolution === 'link' &&
                      row.resolvedPersonId === candidate.personId
                    return (
                      <Button
                        key={candidate.personId}
                        variant={selected ? 'default' : 'outline'}
                        className="h-auto justify-start py-2 text-left"
                        aria-pressed={selected}
                        disabled={savingRow === row.rowIndex}
                        onClick={() =>
                          handleResolve(row.rowIndex, {
                            resolution: 'link',
                            personId: candidate.personId,
                          })
                        }
                      >
                        <span className="flex flex-col">
                          <span className="text-sm font-medium">
                            {candidate.firstName} {candidate.lastName}
                          </span>
                          <span className="text-xs font-normal">
                            {joinParts([
                              candidate.address,
                              candidate.city,
                              candidate.zip,
                              candidate.age !== null
                                ? `age ${candidate.age}`
                                : null,
                            ])}
                          </span>
                        </span>
                      </Button>
                    )
                  })}
                  <Button
                    variant={row.resolution === 'skip' ? 'default' : 'outline'}
                    className="justify-start"
                    aria-pressed={row.resolution === 'skip'}
                    disabled={savingRow === row.rowIndex}
                    onClick={() =>
                      handleResolve(row.rowIndex, { resolution: 'skip' })
                    }
                  >
                    None of these
                  </Button>
                  {row.candidateCount > row.candidates.length && (
                    <p className="text-xs text-muted-foreground">
                      Showing {row.candidates.length} of {row.candidateCount}{' '}
                      matches.
                    </p>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
          <div className="flex items-center justify-between">
            <Button
              variant="outline"
              disabled={isWorking || reviewPage <= 1}
              onClick={() => handleChangePage(reviewPage - 1)}
            >
              Previous
            </Button>
            <p className="text-sm text-muted-foreground">
              Page {reviewPage} of {totalReviewPages}
            </p>
            <Button
              variant="outline"
              disabled={isWorking || reviewPage >= totalReviewPages}
              onClick={() => handleChangePage(reviewPage + 1)}
            >
              Next
            </Button>
          </div>
          {lastSaveMs !== null && (
            <Timing label="Saving your last choice" ms={lastSaveMs} />
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
              {commitResult.counts.contacts} people added
            </h1>
            <p className="text-sm text-muted-foreground">
              {commitResult.counts.verified} verified,{' '}
              {commitResult.counts.unverified} unverified.
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
