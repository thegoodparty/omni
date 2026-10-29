import { useEffect, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import type {
  ContactUploadCandidate,
  SetContactUploadRowMatch,
} from '@goodparty_org/contracts'
import {
  Alert,
  AlertDescription,
  Button,
  CircleAlertIcon,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  RadioGroup,
  RadioGroupItemLabel,
  SearchIcon,
  Spinner,
} from '@styleguide'
import { useContactTypeaheadSearch } from '../useContactTypeaheadSearch'
import {
  setContactUploadRowMatch,
  useContactSources,
} from './importContactsApi'
import {
  SERVE_IMPORT_CONTACTS_COPY,
  candidateLabel,
} from './importContactsCopy'

const COPY = SERVE_IMPORT_CONTACTS_COPY

const SOMEONE_ELSE = 'someone_else'
const NEW_PERSON = 'new_person'
const SKIP = 'skip'

export interface ChangeMatchRow {
  rowId: string
  uploadId: string
  label: string
}

interface ChangeMatchDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  // The upload rows that can be repointed. One from an upload's own page;
  // every row pointing at the person from their record.
  rows: ChangeMatchRow[]
  description?: string
  currentPersonId: string | null
  currentPersonName: string
  candidates?: ContactUploadCandidate[]
}

// Repoints one upload row at another person, a new person, or nobody. Notes
// and activity are recorded against the person, not the row, so they stay
// behind: the dialog says so first whenever the person has any.
export const ChangeMatchDialog = ({
  open,
  onOpenChange,
  rows,
  description,
  currentPersonId,
  currentPersonName,
  candidates = [],
}: ChangeMatchDialogProps) => {
  const queryClient = useQueryClient()
  const sources = useContactSources(currentPersonId, open)
  const [warningAccepted, setWarningAccepted] = useState(false)
  const [rowId, setRowId] = useState('')
  const [choice, setChoice] = useState('')
  const [query, setQuery] = useState('')
  const [otherPersonId, setOtherPersonId] = useState('')
  const search = useContactTypeaheadSearch(choice === SOMEONE_ELSE ? query : '')

  useEffect(() => {
    if (!open) return
    setWarningAccepted(false)
    setRowId(rows.length === 1 ? (rows[0]?.rowId ?? '') : '')
    setChoice('')
    setQuery('')
    setOtherPersonId('')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const change = useMutation({
    mutationFn: ({
      row,
      match,
    }: {
      row: ChangeMatchRow
      match: SetContactUploadRowMatch
    }) => setContactUploadRowMatch(row.uploadId, row.rowId, match),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['contact-uploads'] }),
        queryClient.invalidateQueries({ queryKey: ['contact-sources'] }),
        queryClient.invalidateQueries({ queryKey: ['person'] }),
        queryClient.invalidateQueries({ queryKey: ['contact-engagement'] }),
      ])
      onOpenChange(false)
    },
  })

  const selectedRow = rows.find((row) => row.rowId === rowId)
  const match: SetContactUploadRowMatch | null =
    choice === NEW_PERSON
      ? { newPerson: true }
      : choice === SKIP
        ? { skip: true }
        : choice === SOMEONE_ELSE
          ? otherPersonId
            ? { personId: otherPersonId }
            : null
          : choice
            ? { personId: choice }
            : null

  const showWarning = sources.data?.hasActivity === true && !warningAccepted
  const otherCandidates = candidates.filter(
    (candidate) => candidate.personId !== currentPersonId,
  )

  const submit = () => {
    if (!selectedRow || !match) return
    change.mutate({ row: selectedRow, match })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="z-[2000] max-h-[90dvh] overflow-y-auto">
        {sources.isPending && currentPersonId ? (
          <>
            <DialogTitle className="sr-only">
              {COPY.changeMatch.title}
            </DialogTitle>
            <div className="flex justify-center py-8">
              <Spinner />
            </div>
          </>
        ) : showWarning ? (
          <>
            <DialogHeader>
              <DialogTitle>{COPY.changeMatch.warnTitle}</DialogTitle>
              <DialogDescription>
                {COPY.changeMatch.warnMessage(currentPersonName)}
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                {COPY.changeMatch.cancel}
              </Button>
              <Button onClick={() => setWarningAccepted(true)}>
                {COPY.changeMatch.continue}
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>{COPY.changeMatch.title}</DialogTitle>
              {description && (
                <DialogDescription>{description}</DialogDescription>
              )}
            </DialogHeader>

            {rows.length > 1 && (
              <div className="flex flex-col gap-3">
                <Label>{COPY.changeMatch.whichUpload}</Label>
                <RadioGroup value={rowId} onValueChange={setRowId}>
                  {rows.map((row) => (
                    <RadioGroupItemLabel
                      key={row.rowId}
                      id={`change-match-row-${row.rowId}`}
                      value={row.rowId}
                      label={row.label}
                    />
                  ))}
                </RadioGroup>
              </div>
            )}

            <RadioGroup value={choice} onValueChange={setChoice}>
              {otherCandidates.map((candidate) => (
                <RadioGroupItemLabel
                  key={candidate.personId}
                  id={`change-match-${candidate.personId}`}
                  value={candidate.personId}
                  label={COPY.review.sameAs(candidateLabel(candidate))}
                />
              ))}
              <RadioGroupItemLabel
                id="change-match-someone-else"
                value={SOMEONE_ELSE}
                label={COPY.changeMatch.someoneElse}
              />
              <RadioGroupItemLabel
                id="change-match-new-person"
                value={NEW_PERSON}
                label={COPY.review.newPerson}
              />
              <RadioGroupItemLabel
                id="change-match-skip"
                value={SKIP}
                label={COPY.review.skip}
              />
            </RadioGroup>

            {choice === SOMEONE_ELSE && (
              <div className="flex flex-col gap-3">
                <Input
                  aria-label={COPY.changeMatch.searchLabel}
                  icon={<SearchIcon />}
                  value={query}
                  onChange={(event) => {
                    setQuery(event.target.value)
                    setOtherPersonId('')
                  }}
                  placeholder={COPY.changeMatch.searchPlaceholder}
                />
                {search.isLoading ? (
                  <Spinner />
                ) : search.isEmpty ? (
                  <p className="text-sm text-muted-foreground">
                    {COPY.changeMatch.noResults}
                  </p>
                ) : (
                  <RadioGroup
                    value={otherPersonId}
                    onValueChange={setOtherPersonId}
                  >
                    {search.results
                      .filter((person) => person.id !== currentPersonId)
                      .map((person) => (
                        <RadioGroupItemLabel
                          key={person.id}
                          id={`change-match-search-${person.id}`}
                          value={person.id}
                          label={candidateLabel({
                            firstName: person.firstName,
                            lastName: person.lastName,
                            addressLine: person.address.line1,
                            city: person.address.city,
                          })}
                        />
                      ))}
                  </RadioGroup>
                )}
              </div>
            )}

            {change.isError && (
              <Alert variant="destructive" icon={<CircleAlertIcon />}>
                <AlertDescription>{COPY.changeMatch.failed}</AlertDescription>
              </Alert>
            )}

            <DialogFooter>
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                {COPY.changeMatch.cancel}
              </Button>
              <Button
                onClick={submit}
                disabled={!selectedRow || !match}
                loading={change.isPending}
              >
                {COPY.changeMatch.submit}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
