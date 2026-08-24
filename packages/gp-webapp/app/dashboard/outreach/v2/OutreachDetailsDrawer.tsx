'use client'

import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import type {
  PhoneBankCallOutcome,
  SupportAnswer,
} from '@goodparty_org/contracts'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Button,
  Card,
  Eyebrow,
  Progress,
  StatusText,
  Table,
  TableBody,
  TableCell,
  TableRow,
} from '@styleguide'
import {
  ArchiveIcon,
  CalendarIcon,
  CheckCircleIcon,
  ClockIcon,
  DollarSignIcon,
  DoorOpenIcon,
  FileTextIcon,
  Loader2Icon,
  PhoneIcon,
  Share2Icon,
  Trash2Icon,
  UsersRoundIcon,
} from '@styleguide/components/ui/icons'
import { dateUsHelper } from 'helpers/dateHelper'
import { useSnackbar } from 'helpers/useSnackbar'
import type { VoterFileFilters } from 'helpers/types'
import { clientRequest } from 'gpApi/typed-request'
import { formatAudienceLabels } from 'app/dashboard/outreach/util/formatAudienceLabels.util'
import { OUTREACH_TYPES } from 'app/dashboard/outreach/constants'
import { useOutreach } from 'app/dashboard/outreach/hooks/OutreachContext'
import { ChannelBadge, HistoryStatusText, getChannelLabel } from './channelMeta'
import { getHistoryStatusLabel, type HistoryRow } from './historyStatus.util'
import { useOutreachDetail } from './useOutreachDetail'
import { SocialAssetCard } from './SocialAssetCards'
import { socialPurposeLabel } from './socialPurposes'
import {
  CONTINUE_LABELS,
  listDetailsFooterMode,
  type ListDetailsLifecycle,
} from './listDetails/footerMode'
import { ListDetailsFooter } from './listDetails/ListDetailsFooter'
import { ListDetailsSheetShell } from './listDetails/ListDetailsSheetShell'
import {
  DetailsSection,
  FilterGroup,
  Metric,
  MetricGrid,
} from './listDetails/ListDetailsMetric'

// Copy verified against the phone-banking design screenshots — deliberately
// its own vocabulary rather than a reuse of the caller page's
// phoneBankingOutcome.util.ts labels (that page says "Refused"; this drawer
// says "Refused to engage").
const PHONE_BANKING_OUTCOME_ORDER: PhoneBankCallOutcome[] = [
  'answered',
  'no_answer',
  'voicemail',
  'wrong_number',
  'refused',
]
const PHONE_BANKING_OUTCOME_LABEL: Record<PhoneBankCallOutcome, string> = {
  answered: 'Answered',
  no_answer: 'No answer',
  voicemail: 'Voicemail left',
  wrong_number: 'Wrong number',
  refused: 'Refused to engage',
}

const SUPPORT_ANSWER_LABEL: Record<SupportAnswer, string> = {
  supporter: 'Yes',
  unsure: 'Unsure',
  non_supporter: 'No',
}

const percentLabel = (count: number, total: number): string =>
  total > 0 ? `${Math.round((count / total) * 100)}%` : '0%'

// The status the candidate is reading, mapped onto the canvas's three
// lifecycle positions. Derived from the displayed label rather than from
// `status` so the footer can never contradict the badge two inches above it —
// a p2p row with a live Peerly job reads "Done" while its spine status is
// still `paid`, and offering it a scheduled campaign's actions would be
// answering a question about a different row. The statuses with no canvas
// position (Draft, In review, Denied, Pending payment) map to null, which is
// the footer's `none`: those are states this drawer has nothing to offer in.
const lifecycleOf = (
  statusLabel: string | null,
): ListDetailsLifecycle | null =>
  statusLabel === 'Done'
    ? 'done'
    : statusLabel === 'In progress'
      ? 'in_progress'
      : statusLabel === 'Scheduled'
        ? 'scheduled'
        : null

interface OutreachDetailsDrawerProps {
  row: HistoryRow | null
  onOpenChange: (open: boolean) => void
}

interface DetailRow extends HistoryRow {
  // The list endpoint joins the whole VoterFileFilter row, so the saved list's
  // name rides along with its criteria flags.
  voterFileFilter?: VoterFileFilters & { name?: string | null }
}

export const OutreachDetailsDrawer = ({
  row,
  onOpenChange,
}: OutreachDetailsDrawerProps) => {
  const isSocial = row?.outreachType === OUTREACH_TYPES.socialMedia
  const isPhoneBanking = row?.outreachType === OUTREACH_TYPES.nativePhoneBanking
  const isDoorKnocking = row?.outreachType === OUTREACH_TYPES.nativeDoorKnocking
  const detailQuery = useOutreachDetail(row?.id ?? null, row !== null)
  const social = detailQuery.data?.social
  const phoneBanking = detailQuery.data?.phoneBanking
  const isCompleted = row?.status === 'completed'

  const [outreaches, setOutreaches] = useOutreach()
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false)
  const { errorSnackbar } = useSnackbar()
  const deleteMutation = useMutation({
    mutationFn: () => {
      // The AlertDialog renders outside the row guard, so the confirm can
      // outlive the detail data — never let that send /lists/undefined.
      const listId = phoneBanking?.listId
      if (!listId) return Promise.reject(new Error('listId unavailable'))
      return clientRequest('DELETE /v1/phone-banking/lists/:id', {
        id: String(listId),
      })
    },
    onSuccess: () => {
      setOutreaches(outreaches.filter((o) => o.id !== row?.id))
      setDeleteConfirmOpen(false)
      onOpenChange(false)
    },
    onError: () =>
      errorSnackbar("Couldn't delete this list. Please try again."),
  })

  const isArchived = Boolean(row?.archivedAt)
  const archiveMutation = useMutation({
    mutationFn: () => {
      const rowId = row?.id
      if (!rowId) return Promise.reject(new Error('row unavailable'))
      return clientRequest('PATCH /v1/outreach/:id/archive', {
        id: String(rowId),
        archived: !isArchived,
      })
    },
    onSuccess: ({ data }) => {
      setOutreaches(
        outreaches.map((o) =>
          o.id === row?.id ? { ...o, archivedAt: data.archivedAt } : o,
        ),
      )
      onOpenChange(false)
    },
    onError: () =>
      errorSnackbar(
        isArchived
          ? "Couldn't restore this campaign. Please try again."
          : "Couldn't archive this campaign. Please try again.",
      ),
  })

  const displayDate = row?.date ?? row?.createdAt
  const voterFileFilter = (row as DetailRow | null)?.voterFileFilter
  const audienceLabels = formatAudienceLabels(voterFileFilter || {})
  // The canvas always shows an audience pill; our rows only have one when the
  // campaign was sent to a saved list (social has no audience at all, and
  // phone banking's "all voters" source saves no filter).
  const audienceName = voterFileFilter?.name?.trim() || null
  const sent = row?.textCount ?? row?.billableTextCount

  // Prototype byline verbs ("Scheduled for {date}" / "Sent {date}"); our
  // extra legacy statuses (Draft, In review, …) have no prototype verb and
  // keep the bare date.
  const statusLabel = row ? getHistoryStatusLabel(row) : null
  const bylineVerb =
    statusLabel === 'Scheduled'
      ? 'Scheduled for'
      : statusLabel === 'Done'
        ? 'Sent'
        : null

  // "Is there something this candidate can do about this campaign from here",
  // which is the second half of the canvas's footer decision. True for the two
  // channels we run ourselves and false for the paid ones: a scheduled text or
  // robocall has been bought and is sent by Peerly, with no edit, no delete and
  // nothing to drive, so `automatic` — the canvas's own words for a campaign
  // that needs nothing from you — is the honest footer rather than two dead
  // buttons.
  const selfServe = isPhoneBanking || isDoorKnocking
  const footerMode = listDetailsFooterMode(lifecycleOf(statusLabel), selfServe)
  const continueHref = isPhoneBanking
    ? phoneBanking
      ? `/dashboard/outreach/phone-banking/${phoneBanking.listId}`
      : null
    : // The walk is resumed from the door-knocking surface, which opens on the
      // rail of saved lists. No deeper link exists to offer: this row carries
      // `doorKnockingRouteId`, and nothing maps a route back to the turf whose
      // id the map would need to focus on.
      '/dashboard/door-knocking'

  return (
    <>
      <ListDetailsSheetShell
        open={row !== null}
        onOpenChange={onOpenChange}
        title={row?.name || row?.title || 'Outreach details'}
        header={
          row && (
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h2 className="text-[22px] font-semibold text-foreground">
                  {row.name || row.title || 'Untitled campaign'}
                </h2>
                <HistoryStatusText label={statusLabel} />
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-1.5">
                <ChannelBadge type={row.outreachType} />
                {displayDate && (
                  <span className="text-sm text-muted-foreground">
                    ·{' '}
                    {bylineVerb
                      ? `${bylineVerb} ${dateUsHelper(displayDate, 'long')}`
                      : dateUsHelper(displayDate, 'long')}
                  </span>
                )}
              </div>
            </div>
          )
        }
        footer={
          row && (
            <ListDetailsFooter
              mode={footerMode}
              destructive={
                // Delete stays phone-banking-only: it calls the phone list's
                // own delete endpoint, and no other channel has one.
                footerMode === 'done' &&
                isPhoneBanking &&
                phoneBanking && (
                  <Button
                    variant="ghost"
                    className="shrink-0 text-destructive hover:bg-destructive/10"
                    onClick={() => setDeleteConfirmOpen(true)}
                  >
                    <Trash2Icon className="size-4" />
                    Delete
                  </Button>
                )
              }
              primary={
                footerMode !== 'continue'
                  ? null
                  : continueHref
                    ? {
                        kind: 'link',
                        label: isDoorKnocking
                          ? CONTINUE_LABELS.doorKnocking
                          : CONTINUE_LABELS.phoneBanking,
                        href: continueHref,
                        icon: isDoorKnocking ? (
                          <DoorOpenIcon className="size-4" />
                        ) : (
                          <PhoneIcon className="size-4" />
                        ),
                      }
                    : // Phone banking's href is the list id, which rides the
                      // detail rather than the history row, so it is unknown
                      // for as long as that query is in flight. Holding the
                      // slot disabled beats letting the whole footer appear a
                      // beat after the drawer — the body is already showing
                      // "Loading call progress…", and a CTA that materializes
                      // under a thumb already moving is worse than one that
                      // was visibly not ready yet. Only while loading: once
                      // the detail has failed the body says so and offers the
                      // recovery, and a button that can never enable is not a
                      // state to render.
                      detailQuery.isLoading
                      ? {
                          kind: 'disabled',
                          label: CONTINUE_LABELS.phoneBanking,
                          icon: <PhoneIcon className="size-4" />,
                        }
                      : null
              }
              secondary={
                // Archive applies to every finished row the history's Archive
                // toggle can hide — except a door-knocking one, whose archive
                // is the LIST's and belongs to the door-knocking surface. This
                // row is the campaign-reporting projection of that list, and a
                // second writer that could only reach the projection is exactly
                // how the two `archivedAt` columns drift apart. See the note
                // below and `door-knocking/native/useListArchive.ts`.
                footerMode === 'done' &&
                !isDoorKnocking && (
                  <Button
                    variant="outline"
                    className="w-full"
                    disabled={archiveMutation.isPending}
                    onClick={() => archiveMutation.mutate()}
                  >
                    <ArchiveIcon className="size-4" />
                    {isArchived ? 'Restore from archive' : 'Move to archive'}
                  </Button>
                )
              }
              note={
                footerMode === 'done' &&
                isDoorKnocking &&
                'Archive this from Door knocking, so the list and this record stay in step.'
              }
            />
          )
        }
      >
        {row && (
          <>
            {(audienceName || audienceLabels.length > 0) && (
              <DetailsSection title="Applied filters">
                {audienceName && (
                  <FilterGroup title="Audience" values={[audienceName]} />
                )}
                {audienceLabels.length > 0 && (
                  <FilterGroup title="Filters" values={audienceLabels} />
                )}
              </DetailsSection>
            )}

            <DetailsSection title="Overview">
              <MetricGrid>
                <Metric
                  icon={<CalendarIcon />}
                  label="Date"
                  value={displayDate ? dateUsHelper(displayDate, 'long') : '—'}
                />
                <Metric
                  icon={<FileTextIcon />}
                  label="Name"
                  value={row.name || row.title || 'Untitled campaign'}
                />
                <Metric
                  icon={<Share2Icon />}
                  label="Channel"
                  value={getChannelLabel(row.outreachType)}
                />
                {isSocial ? (
                  <Metric
                    icon={<FileTextIcon />}
                    label="Platforms"
                    value={
                      social
                        ? `${social.assets.length} platform${social.assets.length === 1 ? '' : 's'}`
                        : '—'
                    }
                  />
                ) : isPhoneBanking ? (
                  <Metric
                    icon={<UsersRoundIcon />}
                    label="People"
                    value={
                      phoneBanking
                        ? phoneBanking.peopleTotal.toLocaleString()
                        : '—'
                    }
                  />
                ) : isDoorKnocking ? null : (
                  <Metric
                    icon={<UsersRoundIcon />}
                    label="People"
                    value={
                      typeof sent === 'number' ? sent.toLocaleString() : '—'
                    }
                  />
                )}
                {isSocial && social && (
                  <Metric
                    icon={<FileTextIcon />}
                    label="Purpose"
                    value={socialPurposeLabel(social.purpose)}
                  />
                )}
              </MetricGrid>
              {/* Door knocking's figures are the frozen route's — doors,
                  knockable people, how many have been logged — and this
                  envelope holds none of them, only the route's id. Rather than
                  print a People cell that can only ever say "—", the drawer
                  says where the numbers live; the footer's "Continue knocking"
                  is the way there. */}
              {isDoorKnocking && (
                <p className="text-sm text-muted-foreground">
                  Doors, people and knocking progress for this walk are on the
                  list itself, in Door knocking.
                </p>
              )}
            </DetailsSection>

            {isSocial && detailQuery.isLoading && (
              <StatusText
                tone="muted"
                icon={<Loader2Icon />}
                spinning
                className="text-sm"
              >
                Loading your posts…
              </StatusText>
            )}
            {isSocial && detailQuery.isError && (
              <p className="text-sm text-muted-foreground">
                We couldn&apos;t load this campaign&apos;s posts. Close and try
                again.
              </p>
            )}
            {social && (
              <section className="space-y-3">
                <Eyebrow>Posts · {social.assets.length}</Eyebrow>
                <p className="text-sm text-muted-foreground">
                  The text created for each platform. Copy any post again below.
                </p>
                <div className="space-y-4">
                  {social.assets.map((asset) => (
                    <SocialAssetCard key={asset.platform} asset={asset} />
                  ))}
                </div>
              </section>
            )}

            {isPhoneBanking && detailQuery.isLoading && (
              <StatusText
                tone="muted"
                icon={<Loader2Icon />}
                spinning
                className="text-sm"
              >
                Loading call progress…
              </StatusText>
            )}
            {isPhoneBanking && detailQuery.isError && (
              <p className="text-sm text-muted-foreground">
                We couldn&apos;t load this campaign&apos;s call progress. Close
                and try again.
              </p>
            )}

            {isPhoneBanking && phoneBanking && !isCompleted && (
              <DetailsSection title="Progress">
                <Card className="gap-3 rounded-lg p-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">
                      {phoneBanking.peopleCalled.toLocaleString()} of{' '}
                      {phoneBanking.peopleTotal.toLocaleString()} reached
                    </span>
                    <span className="text-sm font-medium text-foreground">
                      {percentLabel(
                        phoneBanking.peopleCalled,
                        phoneBanking.peopleTotal,
                      )}
                    </span>
                  </div>
                  <Progress
                    value={
                      phoneBanking.peopleTotal > 0
                        ? (phoneBanking.peopleCalled /
                            phoneBanking.peopleTotal) *
                          100
                        : 0
                    }
                  />
                  <MetricGrid>
                    <Metric
                      icon={<CheckCircleIcon />}
                      label="Completed"
                      value={phoneBanking.peopleCalled.toLocaleString()}
                    />
                    <Metric
                      icon={<ClockIcon />}
                      label="Remaining"
                      value={(
                        phoneBanking.peopleTotal - phoneBanking.peopleCalled
                      ).toLocaleString()}
                    />
                  </MetricGrid>
                </Card>
              </DetailsSection>
            )}

            {isPhoneBanking && phoneBanking && !isCompleted && (
              <DetailsSection title="Payment details">
                <MetricGrid>
                  <Metric
                    icon={<DollarSignIcon />}
                    label="Total cost"
                    value="Free"
                  />
                  <Metric
                    icon={<DollarSignIcon />}
                    label="Cost per outreach"
                    value="—"
                  />
                </MetricGrid>
              </DetailsSection>
            )}

            {isPhoneBanking && phoneBanking && isCompleted && (
              <DetailsSection title="Results">
                <p className="text-sm text-muted-foreground">
                  Based on {phoneBanking.entriesCalled.toLocaleString()} phone
                  banking contacts
                </p>
                <Card className="overflow-hidden p-0">
                  <Table>
                    <TableBody>
                      {PHONE_BANKING_OUTCOME_ORDER.map((outcome) => (
                        <TableRow key={outcome}>
                          <TableCell>
                            {PHONE_BANKING_OUTCOME_LABEL[outcome]}
                          </TableCell>
                          <TableCell className="text-right text-muted-foreground">
                            {phoneBanking.byOutcome[outcome]}
                          </TableCell>
                          <TableCell className="text-right text-muted-foreground">
                            {percentLabel(
                              phoneBanking.byOutcome[outcome],
                              phoneBanking.entriesCalled,
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                      {(
                        [
                          ['supporter', phoneBanking.supporters],
                          ['unsure', phoneBanking.unsure],
                          ['non_supporter', phoneBanking.nonSupporters],
                        ] as [SupportAnswer, number][]
                      ).map(([answer, count]) => (
                        <TableRow key={answer}>
                          <TableCell>
                            Support: {SUPPORT_ANSWER_LABEL[answer]}
                          </TableCell>
                          <TableCell className="text-right text-muted-foreground">
                            {count}
                          </TableCell>
                          <TableCell className="text-right text-muted-foreground">
                            {percentLabel(count, phoneBanking.peopleCalled)}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </Card>
              </DetailsSection>
            )}
          </>
        )}
      </ListDetailsSheetShell>

      <AlertDialog open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
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
    </>
  )
}
