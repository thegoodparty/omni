'use client'

import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type {
  SmsOutreachResults,
  OutreachReceipt,
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
  ChartColumnIcon,
  PencilIcon,
  CheckCircleIcon,
  ClockIcon,
  DollarSignIcon,
  DoorOpenIcon,
  FileTextIcon,
  HashIcon,
  Loader2Icon,
  RadioIcon,
  CircleSlashIcon,
  ReceiptIcon,
  Trash2Icon,
  UserMinusIcon,
  UsersRoundIcon,
} from '@styleguide/components/ui/icons'
import { useSnackbar } from 'helpers/useSnackbar'
import { useVoterOutreachV2SmsFlag } from '@shared/experiments/voterOutreachV2SmsFlag'
import type { SmsEditTarget } from './sms/SmsEditFlow'
import type { VoterFileFilters } from 'helpers/types'
import { FetchError } from 'ofetch'
import { clientRequest } from 'gpApi/typed-request'
import { formatAudienceLabels } from 'app/dashboard/outreach/util/formatAudienceLabels.util'
import {
  OUTREACH_OPTIONS,
  OUTREACH_TYPES,
} from 'app/dashboard/outreach/constants'
import { useOutreach } from 'app/dashboard/outreach/hooks/OutreachContext'
import { ExportWalkSheetButton } from 'app/dashboard/door-knocking/native/ExportWalkSheetButton'
import { ChannelBadge, HistoryStatusText, getChannelLabel } from './channelMeta'
import { getHistoryStatusLabel, type HistoryRow } from './historyStatus.util'
import { shortOutreachDate } from './outreachDate.util'
import {
  fetchOutreachDetail,
  outreachDetailQueryKey,
  useOutreachDetail,
  type OutreachDetailFetcher,
} from './useOutreachDetail'
import { OutreachAssigneesSection } from './OutreachAssigneesSection'
import { SocialAssetCard } from './SocialAssetCards'
import { socialPurposeLabel } from './socialPurposes'
import {
  CONTINUE_LABELS,
  continueLabel,
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

// Copy verified against the phone-banking design screenshots — its own
// vocabulary rather than a reuse of the caller page's
// phoneBankingOutcome.util.ts labels, though "Refused" was aligned to the
// caller page's copy (ENG-10945; was "Refused to engage").
const PHONE_BANKING_OUTCOME_ORDER: PhoneBankCallOutcome[] = [
  'answered',
  'no_answer',
  'voicemail',
  'wrong_number',
  'disconnected',
  'refused',
  'hung_up',
]
const PHONE_BANKING_OUTCOME_LABEL: Record<PhoneBankCallOutcome, string> = {
  answered: 'Answered',
  no_answer: 'No answer',
  voicemail: 'Voicemail left',
  wrong_number: 'Wrong number',
  disconnected: 'Disconnected',
  refused: 'Refused',
  hung_up: 'Hung up',
}

const SUPPORT_ANSWER_LABEL: Record<SupportAnswer, string> = {
  supporter: 'Yes',
  unsure: 'Unsure',
  non_supporter: 'No',
}

const percentLabel = (count: number, total: number): string =>
  total > 0 ? `${Math.round((count / total) * 100)}%` : '0%'

const PRICE_PER_TEXT =
  OUTREACH_OPTIONS.find((o) => o.type === OUTREACH_TYPES.text)?.cost ?? 0.035

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
  // with the drawer's already-fetched detail.
  // Detail fetch for this row. Defaults to Win's campaign-scoped read; the
  // Serve caller threads its org-scoped sibling the same bound-function way
  // SocialFlow's `surface` does, so this drawer never forks per surface.
  detailFetcher?: OutreachDetailFetcher
  // Pre-launch only: cancel-window SMS rows offer Edit campaign; the hub
  // opens SmsEditFlow with this. Unused once the compliance flag is on.
  onEdit?: (target: SmsEditTarget) => void
}

interface DetailRow extends HistoryRow {
  // The list endpoint joins the whole VoterFileFilter row, so the saved list's
  // name rides along with its criteria flags.
  voterFileFilter?: VoterFileFilters & { name?: string | null }
}

export const OutreachDetailsDrawer = ({
  row,
  onOpenChange,
  detailFetcher = fetchOutreachDetail,
  onEdit,
}: OutreachDetailsDrawerProps) => {
  const isSocial = row?.outreachType === OUTREACH_TYPES.socialMedia
  const isPhoneBanking = row?.outreachType === OUTREACH_TYPES.nativePhoneBanking
  const isDoorKnocking = row?.outreachType === OUTREACH_TYPES.nativeDoorKnocking
  // A robocall the send chain could not deliver — the spine reads `failed`.
  const isFailedRobocall =
    row?.outreachType === OUTREACH_TYPES.robocall && row?.status === 'failed'
  const detailQuery = useOutreachDetail(
    row?.id ?? null,
    row !== null,
    detailFetcher,
  )
  const social = detailQuery.data?.social
  const phoneBanking = detailQuery.data?.phoneBanking
  const doorKnocking = detailQuery.data?.doorKnocking
  const isCompleted = row?.status === 'completed'
  const isSms =
    row?.outreachType === OUTREACH_TYPES.text ||
    row?.outreachType === OUTREACH_TYPES.p2p
  // Only rows created through the paid P2P flow carry a phone list — the
  // set that has payment details (and possibly a receipt) to show.
  const isPaidFlowSms = isSms && row?.phoneListId != null
  // Launch switch: on, candidate editing is gone and the Statistics card
  // appears; off is exactly the pre-launch drawer.
  const { enabled: complianceV2 } = useVoterOutreachV2SmsFlag(false)

  const [outreaches, setOutreaches] = useOutreach()
  const queryClient = useQueryClient()
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false)
  const { errorSnackbar, successSnackbar } = useSnackbar()
  // Ids ride as mutation variables, never read from `row` in onSuccess:
  // the confirm dialogs portal outside the vaul drawer, so their clicks
  // count as outside-interactions that null the row mid-mutation (the
  // page-refresh-to-see-updates bug).
  const deleteMutation = useMutation({
    mutationFn: ({ listId }: { listId: number; rowId: number }) =>
      clientRequest('DELETE /v1/phone-banking/lists/:id', {
        id: String(listId),
      }),
    onSuccess: (_data, { rowId }) => {
      setOutreaches(outreaches.filter((o) => o.id !== rowId))
      setDeleteConfirmOpen(false)
      onOpenChange(false)
    },
    onError: () =>
      errorSnackbar("Couldn't delete this list. Please try again."),
  })

  // Cancel-before-send: only a paid, scheduled-not-started text campaign
  // (spine status `pending`, created through the P2P flow) is cancelable —
  // the backend enforces the same set.
  const isCancelableSms = isPaidFlowSms && row?.status === 'pending'
  // Delete is reserved for canceled campaigns — cancel already unwound the
  // vendor job and the charge, so the row is pure history. The backend
  // rejects every other status.
  const isCanceled = row?.status === 'canceled'

  // Only rows created through the paid P2P flow ever record a checkout
  // session; the endpoint 404s the rest (free-texts, legacy), which simply
  // leaves the link unrendered.
  const receiptQuery = useQuery({
    queryKey: ['outreach-receipt', row?.id ?? -1],
    queryFn: async (): Promise<OutreachReceipt> => {
      const { data } = await clientRequest('GET /v1/outreach/:id/receipt', {
        id: String(row?.id),
      })
      return data
    },
    enabled: row !== null && isPaidFlowSms,
    retry: false,
    staleTime: 5 * 60 * 1000,
  })
  const receiptUrl = receiptQuery.data?.receiptUrl ?? null
  // 404 is the expected free-row signal the fallback below exists for;
  // anything else (Stripe 502, network) must not masquerade as a computed
  // amount — the section shows an error state instead.
  const receiptFailed =
    receiptQuery.isError &&
    !(
      receiptQuery.error instanceof FetchError &&
      receiptQuery.error.status === 404
    )
  // The receipt is the charge of record; rows without one (free-texts sends
  // 404 it) fall back to the billable count at the standard per-text price —
  // which lands on $0.00, i.e. "Free".
  const totalCost =
    receiptQuery.data?.amount ??
    (row?.billableTextCount ?? row?.textCount ?? 0) * PRICE_PER_TEXT
  const isFreeSms = totalCost <= 0

  // The Statistics card (design prototype): counts + share of contacts for
  // a finished text campaign. Numbers refresh with the hourly report sweep.
  const resultsQuery = useQuery({
    queryKey: ['outreach-results', row?.id ?? -1],
    queryFn: async (): Promise<SmsOutreachResults> => {
      const { data } = await clientRequest('GET /v1/outreach/:id/results', {
        id: String(row?.id),
      })
      return data
    },
    enabled: row !== null && isSms && isCompleted && complianceV2,
    retry: false,
    staleTime: 5 * 60 * 1000,
  })
  const results = resultsQuery.data ?? null
  const statRows = results
    ? [
        { label: 'Responded', count: results.responded },
        {
          label: 'No response',
          count: Math.max(
            0,
            results.contacts - results.responded - results.optedOut,
          ),
        },
        { label: 'Opted out', count: results.optedOut },
      ].map((stat) => ({
        ...stat,
        pct:
          results.contacts > 0
            ? Math.round((stat.count / results.contacts) * 100)
            : 0,
      }))
    : null
  const [cancelConfirmOpen, setCancelConfirmOpen] = useState(false)
  const cancelMutation = useMutation({
    mutationFn: (rowId: number) =>
      clientRequest('POST /v1/outreach/:id/cancel', { id: String(rowId) }),
    onSuccess: ({ data }, rowId) => {
      setOutreaches(
        outreaches.map((o) =>
          o.id === rowId ? { ...o, status: data.outreach.status } : o,
        ),
      )
      queryClient.invalidateQueries({
        queryKey: outreachDetailQueryKey(rowId),
      })
      setCancelConfirmOpen(false)
      onOpenChange(false)
      successSnackbar(
        data.refunded
          ? 'Campaign canceled. Your refund will arrive in 5-10 business days.'
          : 'Campaign canceled.',
      )
    },
    onError: () =>
      errorSnackbar("Couldn't cancel this campaign. Please try again."),
  })

  // Both of these are the same envelope's `archivedAt` for a walk: the block
  // restates it, and the history row carries it directly. Read off the block
  // anyway, because it arrives with the detail rather than with the table —
  // a row this drawer was opened from through a deep link has no cached copy
  // to be right or wrong about.
  const isArchived = Boolean(
    isDoorKnocking ? doorKnocking?.archivedAt : row?.archivedAt,
  )
  const archiveMutation = useMutation({
    mutationFn: () => {
      const rowId = row?.id
      if (!rowId) return Promise.reject(new Error('row unavailable'))
      // Door knocking archives through the TURF's endpoint, never this row's.
      // Both write the same envelope column, but the turf's route is the one
      // the door-knocking rail invalidates against and the one whose response
      // is a turf — so routing the write through it keeps one act with one
      // writer, and this drawer gained the button by gaining the turf id
      // rather than a write of its own.
      if (isDoorKnocking) {
        const turfId = doorKnocking?.turfId
        if (!turfId) return Promise.reject(new Error('turfId unavailable'))
        return clientRequest('POST /v1/door-knocking/turfs/:id/archive', {
          id: String(turfId),
          archived: !isArchived,
        })
      }
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
      // The detail carries the turf's own `archivedAt`, so a stale cache entry
      // would reopen the drawer on the pre-archive answer. Both channels
      // invalidate: the envelope's flag rides the detail too.
      queryClient.invalidateQueries({
        queryKey: outreachDetailQueryKey(row?.id ?? -1),
      })
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
  // An archived row's pill reads "Archived" (prototype: effStatus) — display
  // only, so the footer's lifecycle still resolves off the underlying status
  // and the Restore action stays reachable.
  const displayStatusLabel = isArchived ? 'Archived' : statusLabel

  // "Is there something this candidate can do about this campaign from here",
  // which is the second half of the canvas's footer decision. True for the two
  // channels we run ourselves and false for the paid ones: a scheduled legacy
  // text or robocall is sent by Peerly with nothing to drive, so `automatic`
  // is the honest footer. The paid-flow SMS rows are the exception now that
  // cancel-before-send and canceled-row delete exist for them — they carry
  // their own footer below instead of the mode machine.
  const selfServe = isPhoneBanking || isDoorKnocking
  const footerMode = listDetailsFooterMode(lifecycleOf(statusLabel), selfServe)
  const continueHref = isPhoneBanking
    ? phoneBanking
      ? `/dashboard/outreach/phone-banking/${phoneBanking.listId}`
      : null
    : // Straight into the walk, not onto the rail: every door-knocking row has
      // a routed turf now, so "Continue knocking" has exactly one list it can
      // mean. `outreachId` is the return leg — closing the walk reopens this
      // drawer through the hub's own consume-once deep link, so a candidate
      // who went to knock a list comes back to the row they were reading
      // rather than to a map.
      //
      // Null until the detail lands, which is phone banking's rule for the
      // same reason: the turf id rides the detail, so a link built without it
      // could only go to the bare map. Holding the slot disabled for a moment
      // beats a press that silently lands somewhere else — and a walk whose
      // list has since been deleted keeps the slot disabled for good, which is
      // the truth about a walk with nothing left to knock.
      doorKnocking
      ? `/dashboard/door-knocking?walkTurfId=${doorKnocking.turfId}&outreachId=${row?.id}`
      : null

  const editDetail = detailQuery.data
  const canEditSms =
    !complianceV2 &&
    isCancelableSms &&
    onEdit !== undefined &&
    editDetail !== undefined &&
    editDetail.script !== null &&
    editDetail.date !== null
  const handleEdit = () => {
    if (!canEditSms || !editDetail) return
    onEdit({
      id: editDetail.id,
      name: editDetail.name ?? row?.name ?? '',
      date: new Date(editDetail.date as Date),
      script: editDetail.script as string,
      imageUrl: editDetail.imageUrl,
      contactCount: editDetail.textCount ?? editDetail.billableTextCount ?? 0,
      audienceName: voterFileFilter?.name ?? null,
    })
    onOpenChange(false)
  }

  // The SMS lifecycle actions this branch added have no mode in the canvas's
  // footer vocabulary (its `automatic` predates cancel/delete existing for a
  // paid send), so these rows render their own footer node in the shared
  // footer's container anatomy.
  const smsFooter = isCancelableSms ? (
    <div className="shrink-0 border-t border-border bg-background px-4 py-4 lg:px-6">
      <div className="mx-auto flex w-full max-w-[608px] gap-3">
        {/* Launch switch on: editing is gone (the campaign success team
            fixes messages) and Cancel keeps the full-width treatment. Off:
            the pre-launch Cancel + Edit pair. */}
        <Button
          variant={canEditSms ? 'ghost' : 'outline'}
          className={
            canEditSms
              ? 'shrink-0 text-destructive hover:bg-destructive/10'
              : 'flex-1 border-destructive text-destructive hover:bg-destructive/10'
          }
          disabled={cancelMutation.isPending}
          onClick={() => setCancelConfirmOpen(true)}
        >
          <CircleSlashIcon className="size-4" />
          Cancel campaign
        </Button>
        {canEditSms && (
          <Button className="flex-1" onClick={handleEdit}>
            <PencilIcon className="size-4" />
            Edit campaign
          </Button>
        )}
      </div>
    </div>
  ) : isCanceled ? (
    // Canceled rows keep their record (product decision: history is never
    // hard-deleted — archiving preserves results and generated content off
    // the main table). Same action pair completed rows get.
    <div className="shrink-0 border-t border-border bg-background px-4 py-4 lg:px-6">
      <div className="mx-auto flex w-full max-w-[608px]">
        <Button
          variant="outline"
          className="flex-1"
          disabled={archiveMutation.isPending}
          onClick={() => archiveMutation.mutate()}
        >
          <ArchiveIcon className="size-4" />
          {isArchived ? 'Restore from archive' : 'Move to archive'}
        </Button>
      </div>
    </div>
  ) : null

  return (
    <>
      <ListDetailsSheetShell
        open={row !== null}
        onOpenChange={onOpenChange}
        title={row?.name || row?.title || 'Outreach details'}
        onInteractOutside={(event) => {
          if (cancelConfirmOpen || deleteConfirmOpen) {
            event.preventDefault()
          }
        }}
        header={
          row && (
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h2 className="text-[22px] font-semibold text-foreground">
                  {row.name || row.title || 'Untitled campaign'}
                </h2>
                <HistoryStatusText label={displayStatusLabel} />
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-1.5">
                <ChannelBadge type={row.outreachType} />
                {displayDate && (
                  <span className="text-sm text-muted-foreground">
                    ·{' '}
                    {bylineVerb
                      ? `${bylineVerb} ${shortOutreachDate(displayDate)}`
                      : shortOutreachDate(displayDate)}
                  </span>
                )}
              </div>
            </div>
          )
        }
        footer={
          row &&
          (smsFooter ?? (
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
                          ? continueLabel(
                              'doorKnocking',
                              doorKnocking?.loggedCount ?? 0,
                            )
                          : continueLabel(
                              'phoneBanking',
                              phoneBanking?.peopleCalled ?? 0,
                            ),
                        href: continueHref,
                        // Close the details drawer before navigating so the
                        // destination surface (door knocking's walk sheet
                        // intercept, phone banking's call list route) doesn't
                        // render beneath this vaul drawer's z-50 body portal.
                        // For door knocking specifically the walk sheet lives
                        // in a fixed z-40 container per DoorKnockingFlow.tsx —
                        // it can't win a z-fight with the details drawer, so
                        // we clear it out of the way.
                        onClick: () => onOpenChange(false),
                      }
                    : // Both channels' hrefs are ids that ride the detail —
                      // phone banking's list, door knocking's turf — so
                      // neither is known for as long as that query is in
                      // flight. Holding the slot disabled beats letting the
                      // whole footer appear a beat after the drawer: the body
                      // is already showing its own loading line, and a CTA
                      // that materializes under a thumb already moving is
                      // worse than one that was visibly not ready yet. Only
                      // while loading: once the detail has failed the body
                      // says so and offers the recovery, and a button that can
                      // never enable is not a state to render.
                      detailQuery.isLoading
                      ? {
                          kind: 'disabled',
                          label: isDoorKnocking
                            ? CONTINUE_LABELS.doorKnocking
                            : CONTINUE_LABELS.phoneBanking,
                        }
                      : null
              }
              secondary={
                // Archive now applies to every finished row the history's
                // Archive toggle can hide, door knocking included. What used to
                // block it was reach, not policy: this row is the projection of
                // a saved list, and until the detail carried the turf's id
                // there was no way to write the source from here. It has one
                // now, so the button calls the turf's endpoint (see the
                // mutation) — one writer, both rows, still. Door knocking waits
                // for the detail: without the turf id there is nothing to
                // archive, and a button that resolves to a rejected mutation is
                // worse than one that arrives a beat late.
                footerMode === 'done' &&
                (!isDoorKnocking || Boolean(doorKnocking)) && (
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
                // The turf is still the object, and the rail is still where a
                // walk is managed — so the line stays, saying where this act
                // also shows up rather than sending the candidate away to
                // perform it.
                footerMode === 'done' &&
                isDoorKnocking &&
                Boolean(doorKnocking) &&
                'This archives the saved list too, so Door knocking and this record stay in step.'
              }
            />
          ))
        }
      >
        {row && (
          <>
            {/* First in the body, where the design puts it: the walk sheet is
                the one thing a candidate opens this row to take away, and
                everything below it is a report on a walk that has already
                happened. Gated on the detail having landed rather than on the
                channel alone, because the turf id is what the print route
                needs and it arrives with the detail. */}
            {isDoorKnocking && doorKnocking && (
              <ExportWalkSheetButton turfId={doorKnocking.turfId} />
            )}

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

            {isFailedRobocall && (
              <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-foreground">
                This send couldn&apos;t be delivered. You weren&apos;t charged.
              </div>
            )}

            <DetailsSection title="Overview">
              <MetricGrid>
                <Metric
                  icon={<CalendarIcon />}
                  label="Date"
                  value={displayDate ? shortOutreachDate(displayDate) : '—'}
                />
                <Metric
                  icon={<FileTextIcon />}
                  label="Name"
                  value={row.name || row.title || 'Untitled campaign'}
                />
                <Metric
                  icon={<RadioIcon />}
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
                ) : isDoorKnocking ? (
                  // Doors and people are two figures on a walk, not one: a
                  // multi-unit building is one stop and many doors, and its
                  // residents are more people again. Both are the frozen
                  // route's, from the same aggregate the door-knocking rail
                  // reads — printing a second derivation of either is the
                  // two-denominator failure this feature has a rule against.
                  //
                  // A walk whose list is gone renders neither cell rather than
                  // two em-dashes, which is the rule this drawer already
                  // followed when it had no block at all: the sentence below
                  // says what happened, and a cell that can only say "—" adds
                  // nothing to it.
                  (doorKnocking || detailQuery.isLoading) && (
                    <>
                      <Metric
                        icon={<DoorOpenIcon />}
                        label="Doors"
                        pending={detailQuery.isLoading}
                        value={doorKnocking?.doorCount.toLocaleString() ?? '—'}
                      />
                      <Metric
                        icon={<UsersRoundIcon />}
                        label="People"
                        pending={detailQuery.isLoading}
                        value={
                          doorKnocking?.peopleCount.toLocaleString() ?? '—'
                        }
                      />
                    </>
                  )
                ) : (
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
                {isSms && (
                  // No per-campaign opt-out feed exists yet (the results
                  // sweep is a later slice), so this reads 0 — the same
                  // value the design shows for a not-yet-sent row.
                  <Metric
                    icon={<UserMinusIcon />}
                    label="Unsubscribes"
                    value="0"
                  />
                )}
              </MetricGrid>
              {/* The detail resolves to no block when the saved list behind
                  this walk has been deleted: the envelope and its paid route
                  survive a tombstone, the list does not. So this is the old
                  id-only rendering, kept for the one case that still has
                  nothing to report — never for a walk whose list is intact. */}
              {isDoorKnocking && !doorKnocking && !detailQuery.isLoading && (
                <p className="text-sm text-muted-foreground">
                  This walk&apos;s saved list is no longer available, so its
                  doors and knocking progress can&apos;t be shown.
                </p>
              )}
            </DetailsSection>

            {/* Manager assign/unassign for a self-run list (ENG-11056),
                flag-gated inside the section itself so this renders nothing
                extra when win-team-accounts is off. Volunteers never open
                this drawer (their whole surface is /volunteer's own
                assignments page), so there's no second gate here. */}
            {(isPhoneBanking || isDoorKnocking) && (
              <OutreachAssigneesSection
                outreachId={row.id}
                outreachName={row.name || row.title || undefined}
              />
            )}

            {complianceV2 && isSms && isCompleted && results && statRows && (
              <DetailsSection title="Statistics">
                <div className="overflow-hidden rounded-lg border border-border">
                  <div className="flex items-center gap-2 px-3 py-2 text-xs text-muted-foreground">
                    <ChartColumnIcon className="size-4" />
                    Based on {results.contacts.toLocaleString()} SMS contact
                    {results.contacts === 1 ? '' : 's'}
                  </div>
                  {statRows.map((stat) => (
                    <div
                      key={stat.label}
                      className="flex items-center justify-between border-t border-border px-3 py-2"
                    >
                      <span className="text-sm">{stat.label}</span>
                      <span className="flex items-baseline gap-2">
                        <span className="text-sm font-semibold">
                          {stat.count.toLocaleString()}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {stat.pct}%
                        </span>
                      </span>
                    </div>
                  ))}
                </div>
              </DetailsSection>
            )}

            {isPaidFlowSms && (
              <DetailsSection title="Payment details">
                {receiptFailed && (
                  <p className="text-sm text-muted-foreground">
                    We couldn&apos;t load the payment details. Close and try
                    again.
                  </p>
                )}
                {!receiptFailed && (
                  <MetricGrid>
                    <Metric
                      icon={<DollarSignIcon />}
                      label="Total cost"
                      value={isFreeSms ? 'Free' : `$${totalCost.toFixed(2)}`}
                    />
                    <Metric
                      icon={<HashIcon />}
                      label="Cost per outreach"
                      value={isFreeSms ? '—' : `$${PRICE_PER_TEXT.toFixed(3)}`}
                    />
                  </MetricGrid>
                )}
                {receiptUrl && (
                  <Button
                    type="button"
                    // px-0 loses to the size variant's has-[>svg]:px-4
                    // (different modifier group in tailwind-merge), so
                    // the icon needs its own zero to sit flush left.
                    variant="link"
                    className="h-auto px-0 no-underline has-[>svg]:px-0"
                    onClick={() => {
                      window.open(receiptUrl, '_blank', 'noopener')
                    }}
                  >
                    <ReceiptIcon className="size-4" />
                    View receipt
                  </Button>
                )}
              </DetailsSection>
            )}

            {isSms && row.script && (
              <DetailsSection title="Message">
                {/* The stored script is already the fully composed send
                    (greeting + body + opt-out footer) — render it verbatim,
                    line breaks included. */}
                <Card className="rounded-lg p-3">
                  <p className="text-sm whitespace-pre-wrap text-foreground">
                    {row.script}
                  </p>
                </Card>
              </DetailsSection>
            )}

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

            {isDoorKnocking && detailQuery.isLoading && (
              <StatusText
                tone="muted"
                icon={<Loader2Icon />}
                spinning
                className="text-sm"
              >
                Loading knocking progress…
              </StatusText>
            )}
            {isDoorKnocking && detailQuery.isError && (
              <p className="text-sm text-muted-foreground">
                We couldn&apos;t load this walk&apos;s knocking progress. Close
                and try again.
              </p>
            )}

            {/* Unlike phone banking's, this section does not give way to a
                Results table on a finished row: door knocking has no outcomes
                surface here (ADR 0012), and a walk is routinely ended with
                doors left unlogged — so how much of the list was covered is
                the answer on a done walk too, not only on a live one. */}
            {isDoorKnocking && doorKnocking && (
              <DetailsSection title="Progress">
                <Card className="gap-3 rounded-lg p-3">
                  <div className="flex items-center justify-between">
                    {/* "Logged" and never "reached", the same word the walk
                        and the list's own drawer use: not-home, inaccessible
                        and refused all count here and none is a conversation.
                        Both halves are the knockable people — the flagged
                        residents are out of both — so the ratio never mixes
                        two populations. */}
                    <span className="text-sm text-muted-foreground">
                      {doorKnocking.loggedCount.toLocaleString()} of{' '}
                      {doorKnocking.peopleCount.toLocaleString()} people logged
                    </span>
                    <span className="text-sm font-medium text-foreground">
                      {percentLabel(
                        doorKnocking.loggedCount,
                        doorKnocking.peopleCount,
                      )}
                    </span>
                  </div>
                  <Progress
                    value={
                      doorKnocking.peopleCount > 0
                        ? (doorKnocking.loggedCount /
                            doorKnocking.peopleCount) *
                          100
                        : 0
                    }
                  />
                  <MetricGrid>
                    <Metric
                      icon={<CheckCircleIcon />}
                      label="Logged"
                      value={doorKnocking.loggedCount.toLocaleString()}
                    />
                    <Metric
                      icon={<ClockIcon />}
                      label="Remaining"
                      value={(
                        doorKnocking.peopleCount - doorKnocking.loggedCount
                      ).toLocaleString()}
                    />
                  </MetricGrid>
                </Card>
              </DetailsSection>
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

      <AlertDialog open={cancelConfirmOpen} onOpenChange={setCancelConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancel this campaign?</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure? This can&apos;t be undone. Your texts won&apos;t
              send, and any payment is refunded automatically.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep campaign</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={cancelMutation.isPending}
              onClick={() => row && cancelMutation.mutate(row.id)}
            >
              Cancel campaign
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

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
              onClick={() =>
                row &&
                phoneBanking &&
                deleteMutation.mutate({
                  listId: phoneBanking.listId,
                  rowId: row.id,
                })
              }
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
