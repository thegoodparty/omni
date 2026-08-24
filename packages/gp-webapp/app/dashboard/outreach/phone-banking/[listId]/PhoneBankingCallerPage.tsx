'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { PhoneBankingListEntry } from '@goodparty_org/contracts'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  ArrowLeftIcon,
  Badge,
  Button,
  ChevronDownIcon,
  ChevronRightIcon,
  ChevronUpIcon,
  Card,
  DownloadIcon,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  EllipsisVerticalIcon,
  IconButton,
  Trash2Icon,
  cn,
} from '@styleguide'
import DashboardLayout from 'app/dashboard/shared/DashboardLayout'
import { LoadingAnimation } from 'app/shared/utils/LoadingAnimation'
import { useSnackbar } from 'helpers/useSnackbar'
import { clientRequest } from 'gpApi/typed-request'
import { EVENTS, trackEvent } from 'helpers/analyticsHelper'
import PhoneBankingEntryPanel from './PhoneBankingEntryPanel'
import {
  NOT_CALLED_LABEL,
  OUTCOME_DOT_CLASS,
  OUTCOME_LABEL,
  OUTCOME_ORDER,
  applyCallResults,
  calledPeopleCount,
  isEntrySuppressed,
  outcomeCounts,
  totalPeopleCount,
} from './phoneBankingOutcome.util'

interface PhoneBankingCallerPageProps {
  listId: number
}

const phoneBankingListQueryKey = (listId: number) => [
  'phone-banking-list',
  listId,
]

export default function PhoneBankingCallerPage({
  listId,
}: PhoneBankingCallerPageProps): React.JSX.Element {
  const router = useRouter()
  const queryClient = useQueryClient()
  const { errorSnackbar } = useSnackbar()

  const [expandedEntryIds, setExpandedEntryIds] = useState<Set<number>>(
    new Set(),
  )
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false)
  const [activeSelection, setActiveSelection] = useState<{
    entryId: number
    personId: string
  } | null>(null)

  const listQuery = useQuery({
    queryKey: phoneBankingListQueryKey(listId),
    queryFn: () =>
      clientRequest('GET /v1/phone-banking/lists/:id', {
        id: String(listId),
      }).then((res) => res.data),
  })

  const deleteMutation = useMutation({
    mutationFn: () =>
      clientRequest('DELETE /v1/phone-banking/lists/:id', {
        id: String(listId),
      }),
    onSuccess: () => router.push('/dashboard/outreach'),
    onError: () =>
      errorSnackbar("Couldn't delete this list. Please try again."),
  })

  const list = listQuery.data
  const activeEntry = activeSelection
    ? (list?.entries.find((entry) => entry.id === activeSelection.entryId) ??
      null)
    : null
  const activeEntryIndex =
    list && activeSelection
      ? list.entries.findIndex((entry) => entry.id === activeSelection.entryId)
      : -1
  const hasPrevEntry = activeEntryIndex > 0
  const hasNextEntry = list
    ? activeEntryIndex >= 0 && activeEntryIndex < list.entries.length - 1
    : false

  const goToEntryAt = (index: number) => {
    const target = list?.entries[index]
    const first = target?.persons[0]
    if (target && first)
      setActiveSelection({ entryId: target.id, personId: first.personId })
  }

  const toggleExpanded = (entryId: number) =>
    setExpandedEntryIds((current) => {
      const next = new Set(current)
      if (next.has(entryId)) next.delete(entryId)
      else next.add(entryId)
      return next
    })

  const openPanel = (entry: PhoneBankingListEntry, personId: string) =>
    setActiveSelection({ entryId: entry.id, personId })

  const handleRowClick = (entry: PhoneBankingListEntry) => {
    const first = entry.persons[0]
    if (!first) return
    if (entry.persons.length === 1) {
      openPanel(entry, first.personId)
      return
    }
    toggleExpanded(entry.id)
  }

  const total = list ? totalPeopleCount(list) : 0
  const called = list ? calledPeopleCount(list) : 0
  const counts = list ? outcomeCounts(list) : undefined
  const pct = (n: number) => (total > 0 ? (n / total) * 100 : 0)

  return (
    <DashboardLayout
      pathname="/dashboard/outreach"
      wrapperClassName="!p-0 flex flex-col"
    >
      <div className="flex h-[calc(100dvh-4rem)] w-full flex-col">
        <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
          <div className="flex min-w-0 items-center gap-2">
            <IconButton
              asChild
              variant="ghost"
              size="small"
              aria-label="Back to Voter Outreach"
            >
              <Link href="/dashboard/outreach">
                <ArrowLeftIcon size={18} />
              </Link>
            </IconButton>
            <h1 className="truncate text-lg font-semibold">
              {list?.name ?? 'Phone banking'}
            </h1>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <Button
              asChild
              variant="outline"
              size="small"
              className="rounded-full"
              aria-label="Download call sheet PDF"
              onClick={() =>
                trackEvent(EVENTS.Outreach.PhoneBanking.SheetDownloaded)
              }
            >
              <a href={`/dashboard/outreach/phone-banking/print/${listId}/pdf`}>
                <DownloadIcon size={16} />
                <span className="hidden lg:inline">PDF</span>
              </a>
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <IconButton
                  variant="ghost"
                  size="small"
                  aria-label="More actions"
                >
                  <EllipsisVerticalIcon size={18} />
                </IconButton>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem
                  variant="destructive"
                  onClick={() => setDeleteConfirmOpen(true)}
                >
                  <Trash2Icon size={16} />
                  Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        <AlertDialog
          open={deleteConfirmOpen}
          onOpenChange={setDeleteConfirmOpen}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete this list?</AlertDialogTitle>
              <AlertDialogDescription>
                This deletes the list and every logged call. This can not be
                undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                disabled={deleteMutation.isPending}
                onClick={() => deleteMutation.mutate()}
              >
                Delete
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        <div className="min-h-0 flex-1 overflow-y-auto bg-background px-4 py-4">
          {listQuery.isPending && (
            <div className="flex h-full items-center justify-center">
              <LoadingAnimation />
            </div>
          )}
          {listQuery.isError && (
            <p className="text-sm text-destructive">
              The list could not load. Refresh to try again.
            </p>
          )}
          {list && counts && (
            <div className="mx-auto flex w-full max-w-2xl flex-col gap-4">
              <Card className="gap-3 p-4">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Call progress
                  </span>
                  <Badge variant="secondary" shape="pill">
                    {called}/{total} called
                  </Badge>
                </div>
                <div className="flex h-2 overflow-hidden rounded-full bg-muted">
                  {OUTCOME_ORDER.map((outcome) => (
                    <span
                      key={outcome}
                      className={OUTCOME_DOT_CLASS[outcome]}
                      style={{ width: `${pct(counts[outcome])}%` }}
                    />
                  ))}
                </div>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-muted-foreground">
                  {OUTCOME_ORDER.map((outcome) => (
                    <span
                      key={outcome}
                      className="inline-flex items-center gap-1.5"
                    >
                      <span
                        className={cn(
                          'size-2.5 rounded-full',
                          OUTCOME_DOT_CLASS[outcome],
                        )}
                      />
                      {OUTCOME_LABEL[outcome]} {counts[outcome]}
                    </span>
                  ))}
                </div>
              </Card>

              <Card className="gap-0 overflow-hidden p-0">
                <div className="flex items-center justify-between border-b border-border bg-card p-4">
                  <span className="text-sm font-semibold text-foreground">
                    Contacts
                  </span>
                  <span className="text-sm text-muted-foreground">
                    {total} people
                  </span>
                </div>
                <ol className="divide-y divide-border">
                  {list.entries.map((entry) => {
                    const suppressed = isEntrySuppressed(entry)
                    const expanded = expandedEntryIds.has(entry.id)
                    const single = entry.persons.length === 1
                    const singlePerson = single ? entry.persons[0] : undefined
                    const active = activeSelection?.entryId === entry.id
                    return (
                      <li key={entry.id}>
                        <button
                          type="button"
                          onClick={() => handleRowClick(entry)}
                          className={cn(
                            'flex w-full flex-col gap-1.5 px-4 py-3.5 text-left transition-colors',
                            active ? 'bg-primary/10' : 'hover:bg-muted/50',
                            suppressed && 'opacity-60',
                          )}
                        >
                          <div className="flex items-center gap-3">
                            <span
                              className={cn(
                                'inline-flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-bold',
                                active
                                  ? 'bg-primary text-primary-foreground'
                                  : 'bg-muted text-foreground',
                              )}
                            >
                              {entry.seq}
                            </span>
                            <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
                              {entry.persons.map((p) => p.name).join(', ')}
                            </span>
                            <span className="flex shrink-0 items-center gap-2">
                              {suppressed ? (
                                <Badge variant="destructive" shape="pill">
                                  Wrong number
                                </Badge>
                              ) : single && singlePerson ? (
                                <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                                  {singlePerson.interaction ? (
                                    <>
                                      <span
                                        className={cn(
                                          'size-2 rounded-full',
                                          OUTCOME_DOT_CLASS[
                                            singlePerson.interaction.outcome
                                          ],
                                        )}
                                      />
                                      {
                                        OUTCOME_LABEL[
                                          singlePerson.interaction.outcome
                                        ]
                                      }
                                    </>
                                  ) : (
                                    NOT_CALLED_LABEL
                                  )}
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                                  {entry.persons.length} people
                                  {entry.persons.map((person) => (
                                    <span
                                      key={person.personId}
                                      className={cn(
                                        'size-2 rounded-full',
                                        person.interaction
                                          ? OUTCOME_DOT_CLASS[
                                              person.interaction.outcome
                                            ]
                                          : 'bg-muted-foreground/40',
                                      )}
                                    />
                                  ))}
                                </span>
                              )}
                              {single ? (
                                <ChevronRightIcon
                                  size={16}
                                  className="shrink-0 text-muted-foreground"
                                />
                              ) : expanded ? (
                                <ChevronUpIcon
                                  size={16}
                                  className="shrink-0 text-muted-foreground"
                                />
                              ) : (
                                <ChevronDownIcon
                                  size={16}
                                  className="shrink-0 text-muted-foreground"
                                />
                              )}
                            </span>
                          </div>
                          <span className="truncate pl-9 text-xs text-muted-foreground">
                            {entry.phone}
                          </span>
                        </button>
                        {!single && expanded && (
                          <div className="flex flex-col border-t border-border bg-muted/30">
                            {entry.persons.map((person) => (
                              <button
                                key={person.personId}
                                type="button"
                                onClick={() =>
                                  openPanel(entry, person.personId)
                                }
                                className="flex items-center gap-2 px-4 py-2.5 pl-8 text-left text-sm hover:bg-muted/60"
                              >
                                <span className="min-w-0 flex-1 truncate">
                                  {person.name}
                                </span>
                                <span className="flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
                                  {person.interaction ? (
                                    <>
                                      <span
                                        className={cn(
                                          'size-2 rounded-full',
                                          OUTCOME_DOT_CLASS[
                                            person.interaction.outcome
                                          ],
                                        )}
                                      />
                                      {
                                        OUTCOME_LABEL[
                                          person.interaction.outcome
                                        ]
                                      }
                                    </>
                                  ) : (
                                    NOT_CALLED_LABEL
                                  )}
                                </span>
                                <ChevronRightIcon
                                  size={14}
                                  className="shrink-0 text-muted-foreground"
                                />
                              </button>
                            ))}
                          </div>
                        )}
                      </li>
                    )
                  })}
                </ol>
              </Card>
            </div>
          )}
        </div>
      </div>

      {list && activeEntry && activeSelection && (
        <PhoneBankingEntryPanel
          listId={listId}
          script={list.script}
          entry={activeEntry}
          entryIndex={activeEntry.seq}
          activePersonId={activeSelection.personId}
          onActivePersonChange={(personId) =>
            setActiveSelection({ entryId: activeEntry.id, personId })
          }
          onPrev={() => goToEntryAt(activeEntryIndex - 1)}
          onNext={() => goToEntryAt(activeEntryIndex + 1)}
          hasPrev={hasPrevEntry}
          hasNext={hasNextEntry}
          open
          onOpenChange={(open) => {
            if (!open) setActiveSelection(null)
          }}
          onSaved={(results) => {
            queryClient.setQueryData(
              phoneBankingListQueryKey(listId),
              (old: typeof list | undefined) =>
                old && applyCallResults(old, results),
            )
          }}
        />
      )}
    </DashboardLayout>
  )
}
