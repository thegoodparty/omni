import { useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  useInfiniteQuery,
  useMutation,
  useQueryClient,
} from '@tanstack/react-query'
import type {
  ContactUpload,
  ContactUploadRow,
  SetContactUploadRowMatch,
} from '@goodparty_org/contracts'
import {
  Alert,
  AlertDescription,
  Button,
  Card,
  CircleAlertIcon,
  RadioGroup,
  RadioGroupItemLabel,
  Skeleton,
} from '@styleguide'
import { clientRequest } from 'gpApi/typed-request'
import { useOrganization } from '@shared/organization-picker'
import {
  contactUploadRowsKey,
  contactUploadsKey,
  setContactUploadRowMatch,
} from './importContactsApi'
import {
  SERVE_IMPORT_CONTACTS_COPY,
  UPLOAD_HISTORY_PATH,
  candidateLabel,
} from './importContactsCopy'

const COPY = SERVE_IMPORT_CONTACTS_COPY
const PAGE_SIZE = 50
const NEW_PERSON = 'new_person'
const SKIP = 'skip'

const answerToMatch = (answer: string): SetContactUploadRowMatch =>
  answer === NEW_PERSON
    ? { newPerson: true }
    : answer === SKIP
      ? { skip: true }
      : { personId: answer }

const rowDetails = (row: ContactUploadRow): string =>
  [
    row.email,
    row.cellPhone ?? row.landline,
    [row.addressLine, row.city, row.zip].filter(Boolean).join(', '),
  ]
    .filter(Boolean)
    .join(' · ')

// The rows matching could not settle on its own. Answers are saved together,
// and whatever is left keeps waiting: Decide later changes nothing.
export const NeedsInputReview = ({ upload }: { upload: ContactUpload }) => {
  const router = useRouter()
  const queryClient = useQueryClient()
  const orgSlug = useOrganization()?.slug
  const [answers, setAnswers] = useState<Record<string, string>>({})

  const rowsQuery = useInfiniteQuery({
    queryKey: [...contactUploadRowsKey(orgSlug, upload.id), 'needs_input'],
    queryFn: async ({ pageParam }) =>
      (
        await clientRequest('GET /v1/contact-uploads/:id/rows', {
          id: upload.id,
          outcome: 'needs_input',
          take: PAGE_SIZE,
          ...(pageParam !== undefined ? { cursor: pageParam } : {}),
        })
      ).data,
    initialPageParam: undefined as number | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
  })

  const rows = rowsQuery.data?.pages.flatMap((page) => page.rows) ?? []
  const allLoaded = !rowsQuery.hasNextPage
  const suggestedCount = rows.filter((row) => row.suggestedPersonId).length

  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: contactUploadsKey(orgSlug) })

  const save = useMutation({
    mutationFn: async () => {
      for (const [rowId, answer] of Object.entries(answers)) {
        await setContactUploadRowMatch(upload.id, rowId, answerToMatch(answer))
        setAnswers((current) => {
          const next = { ...current }
          delete next[rowId]
          return next
        })
      }
    },
    onSettled: refresh,
  })

  const acceptSuggested = useMutation({
    mutationFn: async () =>
      (
        await clientRequest('POST /v1/contact-uploads/:id/accept-suggested', {
          id: upload.id,
        })
      ).data,
    onSuccess: refresh,
  })

  const answeredCount = Object.keys(answers).length

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 className="text-lg font-semibold text-foreground">
          {COPY.review.title(upload.needsInputCount)}
        </h2>
        <p className="text-sm text-muted-foreground">{COPY.review.caption}</p>
      </div>

      {suggestedCount > 0 && (
        <Button
          variant="outline"
          className="self-start"
          onClick={() => acceptSuggested.mutate()}
          loading={acceptSuggested.isPending}
        >
          {COPY.review.acceptLikely(allLoaded ? suggestedCount : null)}
        </Button>
      )}

      {rowsQuery.isPending ? (
        <div className="flex flex-col gap-2">
          {[1, 2].map((i) => (
            <Skeleton key={i} className="h-28 w-full" />
          ))}
        </div>
      ) : (
        rows.map((row) => (
          <Card key={row.id} className="flex flex-col gap-3 p-4">
            <div className="flex flex-col gap-0.5">
              <p className="font-semibold text-foreground">
                {candidateLabel(row)}
              </p>
              {rowDetails(row) && (
                <p className="text-sm text-muted-foreground">
                  {rowDetails(row)}
                </p>
              )}
            </div>
            <RadioGroup
              aria-label={candidateLabel(row)}
              value={answers[row.id] ?? ''}
              onValueChange={(value) =>
                setAnswers((current) => ({ ...current, [row.id]: value }))
              }
            >
              {row.candidates.map((candidate) => (
                <RadioGroupItemLabel
                  key={candidate.personId}
                  id={`review-${row.id}-${candidate.personId}`}
                  value={candidate.personId}
                  label={COPY.review.sameAs(candidateLabel(candidate))}
                />
              ))}
              <RadioGroupItemLabel
                id={`review-${row.id}-new`}
                value={NEW_PERSON}
                label={COPY.review.newPerson}
              />
              <RadioGroupItemLabel
                id={`review-${row.id}-skip`}
                value={SKIP}
                label={COPY.review.skip}
              />
            </RadioGroup>
          </Card>
        ))
      )}

      {rowsQuery.hasNextPage && (
        <Button
          variant="ghost"
          className="self-start"
          onClick={() => void rowsQuery.fetchNextPage()}
          loading={rowsQuery.isFetchingNextPage}
        >
          {COPY.review.showMore}
        </Button>
      )}

      {(save.isError || acceptSuggested.isError) && (
        <Alert variant="destructive" icon={<CircleAlertIcon />}>
          <AlertDescription>{COPY.review.saveFailed}</AlertDescription>
        </Alert>
      )}

      <div className="flex flex-wrap justify-end gap-2">
        <Button
          variant="outline"
          onClick={() => router.push(UPLOAD_HISTORY_PATH)}
        >
          {COPY.review.decideLater}
        </Button>
        <Button
          onClick={() => save.mutate()}
          disabled={answeredCount === 0}
          loading={save.isPending}
        >
          {COPY.review.save}
        </Button>
      </div>
    </section>
  )
}
