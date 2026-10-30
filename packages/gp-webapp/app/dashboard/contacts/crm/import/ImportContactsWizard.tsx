import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
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
  Checkbox,
  CircleAlertIcon,
  DrawerTitle,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Spinner,
  Stepper,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  UploadIcon,
} from '@styleguide'
import { useOrganization } from '@shared/organization-picker'
import { EVENTS, trackEvent } from 'helpers/analyticsHelper'
import CrmSheet from '../shared/CrmSheet'
import {
  UPLOAD_HISTORY_PATH,
  getImportContactsCopy,
} from './importContactsCopy'
import {
  emptyColumnMapping,
  parseCsvPreview,
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

// Radix Select items can't carry an empty value.
const DO_NOT_IMPORT = '__do_not_import__'

const isCsvFile = (file: File): boolean =>
  file.name.toLowerCase().endsWith('.csv') || file.type === 'text/csv'

interface ImportContactsWizardProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  isWin: boolean
}

// The Create new list sheet's shell and stepper, for a CSV of people: the
// file, which column holds each detail, then a name and the consent box.
export default function ImportContactsWizard({
  open,
  onOpenChange,
  isWin,
}: ImportContactsWizardProps) {
  const COPY = getImportContactsCopy(isWin)
  const router = useRouter()
  const queryClient = useQueryClient()
  const orgSlug = useOrganization()?.slug
  const bodyRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const uploadsQuery = useContactUploads(open)

  const [step, setStep] = useState<ImportStep>('file')
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<CsvPreview | null>(null)
  const [fileError, setFileError] = useState<string | null>(null)
  const [mapping, setMapping] =
    useState<ColumnMappingDraft>(emptyColumnMapping())
  const [name, setName] = useState('')
  const [consent, setConsent] = useState(false)

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
      onOpenChange(false)
      router.push(UPLOAD_HISTORY_PATH)
    },
  })
  const resetUpload = upload.reset

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
  }, [open, resetUpload])

  useEffect(() => {
    if (bodyRef.current) bodyRef.current.scrollTop = 0
  }, [step])

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
    trackEvent(EVENTS.Contacts.ImportStarted, {
      sourceType: 'csv',
      rowCount: parsed.rowCount,
      product: isWin ? 'win' : 'serve',
    })
  }

  const handleOpenChange = (next: boolean) => {
    if (!next && upload.isPending) return
    if (!next && !upload.isSuccess) {
      trackEvent(EVENTS.Contacts.ImportAbandoned, {
        lastStep: step,
        rowCount: preview?.rowCount ?? null,
        product: isWin ? 'win' : 'serve',
      })
    }
    onOpenChange(next)
  }

  const firstName = mapping.firstName
  const lastName = mapping.lastName
  const canContinueColumns = firstName !== null && lastName !== null
  const trimmedName = name.trim()
  const canImport =
    file !== null &&
    preview !== null &&
    canContinueColumns &&
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
  const rowCount = preview?.rowCount ?? 0

  return (
    <CrmSheet
      open={open}
      onOpenChange={handleOpenChange}
      onBack={
        stepIndex > 0 && !upload.isPending
          ? () => setStep(STEPS[stepIndex - 1] ?? 'file')
          : undefined
      }
      bodyRef={bodyRef}
      header={
        <>
          <DrawerTitle className="sr-only">{COPY.wizard.title}</DrawerTitle>
          <Stepper
            variant="bar"
            currentStep={stepIndex + 1}
            totalSteps={STEPS.length}
            overline={COPY.wizard.title}
          />
        </>
      }
      footer={
        upload.isPending ? undefined : (
          <>
            {step === 'file' && (
              <Button
                type="button"
                className="w-full text-sm"
                onClick={() => setStep('columns')}
                disabled={preview === null}
              >
                {COPY.wizard.continue}
              </Button>
            )}
            {step === 'columns' && (
              <Button
                type="button"
                className="w-full text-sm"
                onClick={() => setStep('name')}
                disabled={!canContinueColumns}
              >
                {COPY.wizard.continue}
              </Button>
            )}
            {step === 'name' && (
              <Button
                type="button"
                className="w-full text-sm"
                onClick={handleImport}
                disabled={!canImport}
              >
                {COPY.wizard.importPeople(rowCount)}
              </Button>
            )}
          </>
        )
      }
    >
      {upload.isPending ? (
        <div
          className="flex flex-col items-center gap-3 py-16 text-center"
          role="status"
        >
          <Spinner />
          <h3 className="text-2xl font-semibold text-foreground">
            {COPY.wizard.importingTitle}
          </h3>
          <p className="text-base text-muted-foreground">
            {COPY.wizard.importingLine(rowCount)}
          </p>
        </div>
      ) : (
        <>
          {step === 'file' && (
            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-1">
                <h3 className="text-2xl font-semibold text-foreground">
                  {COPY.wizard.fileTitle}
                </h3>
                <p className="text-base text-muted-foreground">
                  {COPY.wizard.fileCaption}
                </p>
              </div>
              <div
                className="flex flex-col items-center gap-3 rounded-lg border-2 border-dashed border-border px-4 py-10 text-center"
                onDragOver={(event) => event.preventDefault()}
                onDrop={(event) => {
                  event.preventDefault()
                  void readFile(event.dataTransfer.files[0])
                }}
              >
                <UploadIcon
                  className="size-6 text-muted-foreground"
                  aria-hidden
                />
                <p className="text-base font-medium text-foreground">
                  {COPY.wizard.dropHere}
                </p>
                <Button
                  type="button"
                  variant="outline"
                  size="small"
                  onClick={() => fileInputRef.current?.click()}
                >
                  {file
                    ? COPY.wizard.chooseAnotherFile
                    : COPY.wizard.chooseFile}
                </Button>
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
              </div>
              {fileError && (
                <Alert variant="destructive" icon={<CircleAlertIcon />}>
                  <AlertDescription>{fileError}</AlertDescription>
                </Alert>
              )}
              {preview && !fileError && (
                <p className="text-base text-foreground" aria-live="polite">
                  {COPY.wizard.fileFound(preview.rowCount, preview.headers)}
                </p>
              )}
            </div>
          )}

          {step === 'columns' && preview && (
            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-1">
                <h3 className="text-2xl font-semibold text-foreground">
                  {COPY.wizard.columnsTitle}
                </h3>
                <p className="text-base text-muted-foreground">
                  {COPY.wizard.columnsCaption}
                </p>
              </div>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{COPY.wizard.whatWeKeep}</TableHead>
                    <TableHead>{COPY.wizard.columnInFile}</TableHead>
                    <TableHead>{COPY.wizard.example}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {CONTACT_UPLOAD_FIELDS.map((field) => {
                    const header = mapping[field]
                    return (
                      <TableRow key={field}>
                        <TableCell className="font-medium">
                          {COPY.fields[field]}
                        </TableCell>
                        <TableCell>
                          <Select
                            value={header ?? DO_NOT_IMPORT}
                            onValueChange={(value) =>
                              setMapping((current) => ({
                                ...current,
                                [field]: value === DO_NOT_IMPORT ? null : value,
                              }))
                            }
                          >
                            <SelectTrigger
                              className="w-full min-w-40"
                              aria-label={COPY.fields[field]}
                            >
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent className="z-[1400]">
                              {preview.headers.map((option) => (
                                <SelectItem key={option} value={option}>
                                  {option}
                                </SelectItem>
                              ))}
                              <SelectItem value={DO_NOT_IMPORT}>
                                {COPY.wizard.doNotImport}
                              </SelectItem>
                            </SelectContent>
                          </Select>
                        </TableCell>
                        <TableCell className="max-w-40 truncate text-muted-foreground">
                          {header ? (preview.examples[header] ?? '') : ''}
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </div>
          )}

          {step === 'name' && (
            <div className="flex flex-col gap-6">
              <div className="flex flex-col gap-1">
                <h3 className="text-2xl font-semibold text-foreground">
                  {COPY.wizard.nameTitle}
                </h3>
                <p className="text-base text-muted-foreground">
                  {COPY.wizard.nameCaption(rowCount)}
                </p>
              </div>
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
                <p className="text-xs text-muted-foreground">
                  {trimmedName.length}/{CONTACT_UPLOAD_NAME_MAX_LENGTH}
                </p>
              </div>
              <div className="flex items-start gap-3">
                <Checkbox
                  id="import-contacts-consent"
                  checked={consent}
                  onCheckedChange={(value) => setConsent(value === true)}
                  className="mt-0.5"
                />
                <Label
                  htmlFor="import-contacts-consent"
                  className="block text-base font-normal"
                >
                  {COPY.wizard.consent}
                </Label>
              </div>
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
    </CrmSheet>
  )
}
