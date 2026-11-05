import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  CONTACT_UPLOAD_FIELDS,
  CONTACT_UPLOAD_MAX_BYTES,
  CONTACT_UPLOAD_MAX_ROWS,
  CONTACT_UPLOAD_NAME_MAX_LENGTH,
  type ContactUploadColumnMapping,
} from '@goodparty_org/contracts'
import {
  Alert,
  AlertDescription,
  Button,
  CheckboxLabel,
  CircleAlertIcon,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Spinner,
  UploadIcon,
} from '@styleguide'
import { cn } from '@styleguide/lib/utils'
import { useOrganization } from '@shared/organization-picker'
import { EVENTS, trackEvent } from 'helpers/analyticsHelper'
import { OutreachFlowShell } from 'app/dashboard/outreach/v2/OutreachFlowShell'
import { Intro } from 'app/dashboard/outreach/v2/social/Intro'
import { LengthCounter } from 'app/dashboard/shared/compose/LengthCounter'
import {
  UPLOAD_HISTORY_PATH,
  getImportContactsCopy,
} from './importContactsCopy'
import {
  countImportRows,
  emptyColumnMapping,
  parseCsvPreview,
  headerNamingField,
  prefillColumnMapping,
  type ColumnMappingDraft,
  type CsvPreview,
} from './importContactsCsv'
import {
  contactUploadsKey,
  createContactUpload,
  useContactUploads,
} from './importContactsApi'

const STEPS = ['file', 'columns', 'name'] as const
type ImportStep = (typeof STEPS)[number]

const REQUIRED_FIELDS = ['firstName', 'lastName'] as const
const COLUMNS_SHOWN_AT_FIRST = 10

// Radix Select items can't carry an empty value.
const DO_NOT_IMPORT = '__do_not_import__'

const isCsvFile = (file: File): boolean =>
  file.name.toLowerCase().endsWith('.csv') || file.type === 'text/csv'

interface ImportContactsWizardProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  isWin: boolean
}

// The outreach flows' full-screen shell and stepper, for a CSV of people: the
// file, which column holds each detail, then a name and the consent box.
export default function ImportContactsWizard({
  open,
  onOpenChange,
  isWin,
}: ImportContactsWizardProps) {
  const COPY = getImportContactsCopy(isWin)
  const router = useRouter()
  const pathname = usePathname()
  const queryClient = useQueryClient()
  const orgSlug = useOrganization()?.slug
  const fileInputRef = useRef<HTMLInputElement>(null)
  const uploadsQuery = useContactUploads(open)

  const [step, setStep] = useState<ImportStep>('file')
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<CsvPreview | null>(null)
  const [fileError, setFileError] = useState<string | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [mapping, setMapping] =
    useState<ColumnMappingDraft>(emptyColumnMapping())
  const [name, setName] = useState('')
  const [consent, setConsent] = useState(false)
  const [showAllColumns, setShowAllColumns] = useState(false)
  const errorIdPrefix = useId()
  // The column that last held first or last name, so a name taken off a
  // column marks that column when Continue is pressed.
  const [lastNameColumns, setLastNameColumns] = useState<
    Record<(typeof REQUIRED_FIELDS)[number], string | null>
  >({ firstName: null, lastName: null })

  const upload = useMutation({
    mutationFn: createContactUpload,
    onSuccess: async () => {
      trackEvent(EVENTS.Contacts.ImportConsentAffirmed, {
        rowCount: preview?.rowCount ?? null,
        product: isWin ? 'win' : 'serve',
      })
      await queryClient.invalidateQueries({
        queryKey: contactUploadsKey(orgSlug),
      })
      router.push(UPLOAD_HISTORY_PATH)
    },
  })
  const resetUpload = upload.reset
  const isSending = upload.isPending || upload.isSuccess

  // Stays open on the sending screen until Imports is the route, so
  // the page it was opened from never shows in between.
  useEffect(() => {
    if (upload.isSuccess && pathname === UPLOAD_HISTORY_PATH) {
      onOpenChange(false)
    }
  }, [upload.isSuccess, pathname, onOpenChange])

  useEffect(() => {
    if (!open) return
    resetUpload()
    setStep('file')
    setFile(null)
    setPreview(null)
    setFileError(null)
    setMapping(emptyColumnMapping())
    setName('')
    setConsent(false)
    setShowAllColumns(false)
    setLastNameColumns({ firstName: null, lastName: null })
  }, [open, resetUpload])

  const latestMapping: ContactUploadColumnMapping | null =
    [...(uploadsQuery.data?.uploads ?? [])].sort((a, b) =>
      b.createdAt.localeCompare(a.createdAt),
    )[0]?.columnMapping ?? null

  const readFile = async (picked: File | undefined) => {
    if (!picked) return
    setFileError(null)
    if (!isCsvFile(picked)) {
      setFileError(COPY.wizard.notCsv)
      return
    }
    if (picked.size > CONTACT_UPLOAD_MAX_BYTES) {
      setFileError(COPY.wizard.tooBig)
      return
    }
    let parsed: CsvPreview
    try {
      const text = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(String(reader.result ?? ''))
        reader.onerror = () => reject(reader.error)
        reader.readAsText(picked)
      })
      parsed = parseCsvPreview(text)
    } catch {
      setFileError(COPY.wizard.unreadable)
      return
    }
    if (parsed.headers.length === 0 || parsed.rowCount === 0) {
      setFileError(COPY.wizard.noRows)
      return
    }
    if (parsed.rowCount > CONTACT_UPLOAD_MAX_ROWS) {
      setFileError(COPY.wizard.tooManyRows)
      return
    }
    setFile(picked)
    setPreview(parsed)
    setMapping(prefillColumnMapping(parsed.headers, latestMapping))
    setShowAllColumns(false)
    trackEvent(EVENTS.Contacts.ImportStarted, {
      sourceType: 'csv',
      rowCount: parsed.rowCount,
      product: isWin ? 'win' : 'serve',
    })
  }

  const handleClose = () => {
    if (upload.isPending) return
    if (!upload.isSuccess) {
      trackEvent(EVENTS.Contacts.ImportAbandoned, {
        lastStep: step,
        rowCount: preview?.rowCount ?? null,
        product: isWin ? 'win' : 'serve',
      })
    }
    onOpenChange(false)
  }

  // One column feeds one field: picking a field another column holds moves it
  // here, and that column drops to Do not import.
  const assignColumn = (header: string, value: string) => {
    const picked = CONTACT_UPLOAD_FIELDS.find((option) => option === value)
    REQUIRED_FIELDS.forEach((field) => {
      if (mapping[field] === header && picked !== field) {
        setLastNameColumns((current) => ({ ...current, [field]: header }))
      }
    })
    setMapping((current) => {
      const next = { ...current }
      CONTACT_UPLOAD_FIELDS.forEach((option) => {
        if (next[option] === header) next[option] = null
      })
      if (picked) next[picked] = header
      return next
    })
  }

  const firstName = mapping.firstName
  const lastName = mapping.lastName
  const canContinueColumns = firstName !== null && lastName !== null
  const columnHeaders = preview?.headers ?? []

  const trimmedName = name.trim()
  const rowCounts = useMemo(
    () => (preview ? countImportRows(preview, mapping) : null),
    [preview, mapping],
  )
  const importableCount = rowCounts?.importable ?? 0
  const columnErrors = useMemo(() => {
    const errors: Record<string, string[]> = {}
    if (!preview) return errors
    const add = (header: string | undefined, message: string) => {
      if (header === undefined) return
      errors[header] = [...(errors[header] ?? []), message]
    }
    REQUIRED_FIELDS.forEach((field) => {
      const header = mapping[field]
      if (header === null) {
        add(
          lastNameColumns[field] ??
            headerNamingField(preview.headers, field) ??
            preview.headers[0],
          COPY.wizard.columnErrors.missing[field],
        )
      } else if (preview.rows.every((row) => (row[header] ?? '') === '')) {
        add(header, COPY.wizard.columnErrors.empty[field])
      }
    })
    if (
      Object.keys(errors).length === 0 &&
      rowCounts?.importable === 0 &&
      mapping.firstName !== null &&
      mapping.lastName !== null
    ) {
      add(mapping.firstName, COPY.wizard.columnErrors.noOneHasBoth)
      add(mapping.lastName, COPY.wizard.columnErrors.noOneHasBoth)
    }
    return errors
  }, [preview, mapping, lastNameColumns, rowCounts, COPY])
  const columnsReady = Object.keys(columnErrors).length === 0
  // A reason sitting in a hidden column would leave Continue off with
  // nothing on screen to say why.
  const errorHidden = Object.keys(columnErrors).some(
    (header) => columnHeaders.indexOf(header) >= COLUMNS_SHOWN_AT_FIRST,
  )
  const visibleHeaders =
    showAllColumns || errorHidden
      ? columnHeaders
      : columnHeaders.slice(0, COLUMNS_SHOWN_AT_FIRST)
  const canImport =
    file !== null &&
    preview !== null &&
    canContinueColumns &&
    importableCount > 0 &&
    trimmedName.length > 0 &&
    consent

  const handleImport = () => {
    if (!canImport || firstName === null || lastName === null) return
    upload.mutate({
      file,
      name: trimmedName,
      columnMapping: { ...mapping, firstName, lastName },
    })
  }

  const stepIndex = STEPS.indexOf(step)

  return (
    <OutreachFlowShell
      open={open}
      onClose={handleClose}
      title={COPY.wizard.title}
      headerBadge={COPY.wizard.title}
      currentStep={isSending ? 0 : stepIndex + 1}
      totalSteps={isSending ? 0 : STEPS.length}
      onBack={
        stepIndex > 0 && !isSending
          ? () => setStep(STEPS[stepIndex - 1] ?? 'file')
          : undefined
      }
      cta={
        isSending
          ? null
          : step === 'file'
            ? {
                label: COPY.wizard.continue,
                onClick: () => setStep('columns'),
                disabled: preview === null,
              }
            : step === 'columns'
              ? {
                  label: COPY.wizard.continue,
                  onClick: () => setStep('name'),
                  disabled: !columnsReady,
                }
              : {
                  label: COPY.wizard.importPeople(importableCount),
                  onClick: handleImport,
                  disabled: !canImport,
                }
      }
      dirty={file !== null && !isSending}
    >
      {isSending ? (
        <div
          className="flex flex-col items-center gap-3 py-16 text-center"
          role="status"
        >
          <Spinner />
          <h3 className="text-2xl font-semibold text-foreground">
            {COPY.wizard.sendingTitle}
          </h3>
          <p className="text-base text-muted-foreground">
            {COPY.wizard.sendingLine(importableCount)}
          </p>
        </div>
      ) : (
        <>
          {step === 'file' && (
            <div className="flex flex-col gap-6">
              <h3 className="text-2xl font-semibold text-foreground">
                {COPY.wizard.fileTitle}
              </h3>
              <div
                className={cn(
                  'flex cursor-pointer flex-col items-center gap-3 rounded-lg border-2 border-dashed border-border px-4 py-10 text-center transition-colors hover:border-primary/50 hover:bg-muted',
                  isDragging && 'border-primary bg-muted',
                )}
                onClick={() => fileInputRef.current?.click()}
                onDragOver={(event) => {
                  event.preventDefault()
                  setIsDragging(true)
                }}
                onDragLeave={(event) => {
                  if (
                    !event.currentTarget.contains(event.relatedTarget as Node)
                  ) {
                    setIsDragging(false)
                  }
                }}
                onDrop={(event) => {
                  event.preventDefault()
                  setIsDragging(false)
                  void readFile(event.dataTransfer.files[0])
                }}
              >
                <UploadIcon
                  className="size-6 text-muted-foreground"
                  aria-hidden
                />
                <div className="flex flex-col items-center gap-0.5">
                  <p className="break-all text-base font-medium text-foreground">
                    {file ? file.name : COPY.wizard.dropHere}
                  </p>
                  {preview && !fileError && (
                    <p
                      className="text-sm text-muted-foreground"
                      aria-live="polite"
                    >
                      {COPY.wizard.peopleFound(preview.rowCount)}
                    </p>
                  )}
                </div>
                <Button type="button" variant="outline" size="small">
                  {file
                    ? COPY.wizard.chooseAnotherFile
                    : COPY.wizard.chooseFile}
                </Button>
                <p className="text-sm text-muted-foreground">
                  {COPY.wizard.fileCaption}
                </p>
              </div>
              <Input
                ref={fileInputRef}
                type="file"
                accept=".csv,text/csv"
                aria-label={COPY.wizard.chooseFile}
                className="hidden"
                onChange={(event) => {
                  void readFile(event.target.files?.[0])
                  event.target.value = ''
                }}
              />
              {fileError && (
                <Alert variant="destructive" icon={<CircleAlertIcon />}>
                  <AlertDescription>{fileError}</AlertDescription>
                </Alert>
              )}
            </div>
          )}

          {step === 'columns' && preview && (
            <div className="flex flex-col gap-6">
              {/* The count reads from the columns chosen below, so it
                  follows any change to the name columns. */}
              <Intro
                title={COPY.wizard.columnsTitle}
                body={
                  <>
                    {COPY.wizard.columnsCaption}{' '}
                    <span aria-live="polite">
                      {COPY.wizard.namesRequired(
                        rowCounts && canContinueColumns
                          ? {
                              total: rowCounts.total,
                              withNames: rowCounts.importable,
                            }
                          : null,
                      )}
                    </span>
                  </>
                }
              />
              {/* Not Table: its cell padding squeezed the picker on a phone.
                  The header row takes TableHead's height and type. */}
              <div className="flex flex-col divide-y divide-border">
                <div className="grid h-11 grid-cols-[minmax(0,1fr)_minmax(0,1.25fr)] items-center gap-3 text-sm font-normal text-foreground sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
                  <span>{COPY.wizard.columnInFile}</span>
                  <span>{COPY.wizard.importAs}</span>
                </div>
                {visibleHeaders.map((header) => {
                  const field =
                    CONTACT_UPLOAD_FIELDS.find(
                      (option) => mapping[option] === header,
                    ) ?? null
                  const examples = preview.examples[header] ?? []
                  const errors = columnErrors[header]
                  return (
                    <div
                      key={header}
                      className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.25fr)] items-start gap-3 py-3 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]"
                    >
                      <div className="flex min-w-0 flex-col">
                        <span className="truncate text-sm font-medium text-foreground">
                          {header}
                        </span>
                        {examples.length > 0 && (
                          <span className="truncate text-xs text-muted-foreground">
                            {examples.join(' · ')}
                          </span>
                        )}
                      </div>
                      <div className="flex min-w-0 flex-col gap-1.5">
                        <Select
                          value={field ?? DO_NOT_IMPORT}
                          onValueChange={(value) => assignColumn(header, value)}
                        >
                          <SelectTrigger
                            className="w-full"
                            aria-label={header}
                            aria-invalid={errors ? true : undefined}
                            aria-describedby={
                              errors
                                ? `${errorIdPrefix}-${columnHeaders.indexOf(header)}`
                                : undefined
                            }
                          >
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {CONTACT_UPLOAD_FIELDS.map((option) => (
                              <SelectItem key={option} value={option}>
                                {COPY.fields[option]}
                                {REQUIRED_FIELDS.some(
                                  (required) => required === option,
                                ) && ' *'}
                              </SelectItem>
                            ))}
                            <SelectItem value={DO_NOT_IMPORT}>
                              {COPY.wizard.doNotImport}
                            </SelectItem>
                          </SelectContent>
                        </Select>
                        {errors && (
                          <p
                            id={`${errorIdPrefix}-${columnHeaders.indexOf(header)}`}
                            className="text-sm text-destructive"
                          >
                            {errors.join(' ')}
                          </p>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
              {columnHeaders.length > visibleHeaders.length && (
                <Button
                  type="button"
                  variant="ghost"
                  className="self-start"
                  onClick={() => setShowAllColumns(true)}
                >
                  {COPY.wizard.showMoreColumns(
                    columnHeaders.length - visibleHeaders.length,
                  )}
                </Button>
              )}
            </div>
          )}

          {step === 'name' && (
            <div className="flex flex-col gap-6">
              <Intro
                title={COPY.wizard.nameTitle}
                body={COPY.wizard.nameCaption}
              />
              <div className="flex flex-col gap-2">
                <Label htmlFor="import-contacts-name">
                  {COPY.wizard.nameLabel}
                </Label>
                <Input
                  id="import-contacts-name"
                  value={name}
                  onChange={(event) =>
                    setName(
                      event.target.value.slice(
                        0,
                        CONTACT_UPLOAD_NAME_MAX_LENGTH,
                      ),
                    )
                  }
                  maxLength={CONTACT_UPLOAD_NAME_MAX_LENGTH}
                  placeholder={COPY.wizard.namePlaceholder}
                />
                <LengthCounter
                  length={name.length}
                  max={CONTACT_UPLOAD_NAME_MAX_LENGTH}
                />
              </div>
              <CheckboxLabel
                id="import-contacts-consent"
                label={COPY.wizard.consent}
                checked={consent}
                onCheckedChange={(value) => setConsent(value === true)}
              />
              {upload.isError && (
                <Alert variant="destructive" icon={<CircleAlertIcon />}>
                  <AlertDescription>
                    {COPY.wizard.importFailed}
                  </AlertDescription>
                </Alert>
              )}
            </div>
          )}
        </>
      )}
    </OutreachFlowShell>
  )
}
