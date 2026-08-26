'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type {
  OutreachReceipt,
  PhoneBankCallOutcome,
  SupportAnswer,
} from '@goodparty_org/contracts'
import { PeerlyCvVerificationStatus } from '@goodparty_org/contracts'
import {
  Alert,
  AlertAction,
  AlertDescription,
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertTitle,
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
  HashIcon,
  Loader2Icon,
  PhoneIcon,
  RadioIcon,
  ReceiptIcon,
  ShieldAlertIcon,
  ShieldCheckIcon,
  Trash2Icon,
  UserMinusIcon,
  UsersRoundIcon,
  XCircleIcon,
} from '@styleguide/components/ui/icons'
import { useSnackbar } from 'helpers/useSnackbar'
import type { TcrCompliance, VoterFileFilters } from 'helpers/types'
import { clientRequest } from 'gpApi/typed-request'
import { formatAudienceLabels } from 'app/dashboard/outreach/util/formatAudienceLabels.util'
import { OUTREACH_TYPES } from 'app/dashboard/outreach/constants'
import { OUTREACH_OPTIONS } from 'app/dashboard/outreach/components/OutreachCreateCards'
import { useOutreach } from 'app/dashboard/outreach/hooks/OutreachContext'
import {
  ELECTION_FILING_PATH,
  SUBMIT_PIN_PATH,
} from 'app/dashboard/shared/ComplianceModal'
import { TCR_COMPLIANCE_STATUS } from 'app/dashboard/profile/texting-compliance/util/tcrCompliance.util'
import {
  ChannelBadge,
  HistoryStatusText,
  WILL_NOT_SEND_LABEL,
  getChannelLabel,
} from './channelMeta'
import { getHistoryStatusLabel, type HistoryRow } from './historyStatus.util'
import { shortOutreachDate } from './outreachDate.util'
import { outreachDetailQueryKey, useOutreachDetail } from './useOutreachDetail'
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
  // CampaignVerify clearance state: while pending, scheduled SMS rows show
  // "Needs compliance" and the footer offers Cancel + Start verification.
  tcrCompliance?: TcrCompliance
}

interface DetailRow extends HistoryRow {
  // The list endpoint joins the whole VoterFileFilter row, so the saved list's
  // name rides along with its criteria flags.
  voterFileFilter?: VoterFileFilters & { name?: string | null }
}

export const OutreachDetailsDrawer = ({
  row,
  onOpenChange,
  tcrCompliance,
}: OutreachDetailsDrawerProps) => {
  const router = useRouter()
  const isSocial = row?.outreachType === OUTREACH_TYPES.socialMedia
  const isPhoneBanking = row?.outreachType === OUTREACH_TYPES.nativePhoneBanking
  const isDoorKnocking = row?.outreachType === OUTREACH_TYPES.nativeDoorKnocking
  const detailQuery = useOutreachDetail(row?.id ?? null, row !== null)
  const social = detailQuery.data?.social
  const phoneBanking = detailQuery.data?.phoneBanking
  const isCompleted = row?.status === 'completed'
  const isSms =
    row?.outreachType === OUTREACH_TYPES.text ||
    row?.outreachType === OUTREACH_TYPES.p2p
  // Only rows created through the paid P2P flow carry a phone list — the
  // set that has payment details (and possibly a receipt) to show.
  const isPaidFlowSms = isSms && row?.phoneListId != null

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
  // A scheduled SMS row while CampaignVerify clearance pends: the carriers
  // will hold the send, so the drawer flags it and swaps the footer to
  // Cancel + Start verification.
  const notCleared =
    tcrCompliance?.peerlyCvStatus !== PeerlyCvVerificationStatus.VERIFIED
  const isPendingVerificationSms = isCancelableSms && notCleared

  // ComplianceModal's status-aware target: SUBMITTED waits on the
  // CampaignVerify PIN; anything else enters at the election-filing form.
  const startVerification = () => {
    router.push(
      tcrCompliance?.status === TCR_COMPLIANCE_STATUS.SUBMITTED
        ? SUBMIT_PIN_PATH
        : ELECTION_FILING_PATH,
    )
    onOpenChange(false)
  }

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
  // The receipt is the charge of record; rows without one (free-texts sends
  // 404 it) fall back to the billable count at the standard per-text price —
  // which lands on $0.00, i.e. "Free".
  const totalCost =
    receiptQuery.data?.amount ??
    (row?.billableTextCount ?? row?.textCount ?? 0) * PRICE_PER_TEXT
  const isFreeSms = totalCost <= 0
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

  const [deleteCanceledConfirmOpen, setDeleteCanceledConfirmOpen] =
    useState(false)
  const deleteCanceledMutation = useMutation({
    mutationFn: (rowId: number) =>
      clientRequest('DELETE /v1/outreach/:id', { id: String(rowId) }),
    onSuccess: (_data, rowId) => {
      setOutreaches(outreaches.filter((o) => o.id !== rowId))
      setDeleteCanceledConfirmOpen(false)
      onOpenChange(false)
      successSnackbar('Campaign deleted.')
    },
    onError: () =>
      errorSnackbar("Couldn't delete this campaign. Please try again."),
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
  // The pill next to the title swaps to the warning label; the byline keeps
  // "Scheduled for {date}" — the send date itself is unchanged.
  const displayStatusLabel = isPendingVerificationSms
    ? WILL_NOT_SEND_LABEL
    : statusLabel

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
    : // The walk is resumed from the door-knocking surface, which opens on the
      // rail of saved lists. No deeper link exists to offer: this row carries
      // `doorKnockingRouteId`, and nothing maps a route back to the turf whose
      // id the map would need to focus on.
      '/dashboard/door-knocking'

  // The SMS lifecycle actions this branch added have no mode in the canvas's
  // footer vocabulary (its `automatic` predates cancel/delete existing for a
  // paid send), so these rows render their own footer node in the shared
  // footer's container anatomy.
  const smsFooter = isPendingVerificationSms ? (
    <div className="shrink-0 border-t border-border bg-background px-4 py-4 lg:px-6">
      <div className="mx-auto flex w-full max-w-[608px] gap-3">
        <Button
          variant="ghost"
          className="shrink-0 text-destructive hover:bg-destructive/10"
          disabled={cancelMutation.isPending}
          onClick={() => setCancelConfirmOpen(true)}
        >
          <XCircleIcon className="size-4" />
          Cancel
        </Button>
        <Button className="flex-1" onClick={startVerification}>
          <ShieldCheckIcon className="size-4" />
          Start verification
        </Button>
      </div>
    </div>
  ) : isCancelableSms ? (
    <div className="shrink-0 border-t border-border bg-background px-4 py-4 lg:px-6">
      <div className="mx-auto flex w-full max-w-[608px]">
        <Button
          variant="outline"
          className="flex-1 border-destructive text-destructive hover:bg-destructive/10"
          disabled={cancelMutation.isPending}
          onClick={() => setCancelConfirmOpen(true)}
        >
          <XCircleIcon className="size-4" />
          Cancel campaign
        </Button>
      </div>
    </div>
  ) : isCanceled ? (
    <div className="shrink-0 border-t border-border bg-background px-4 py-4 lg:px-6">
      <div className="mx-auto flex w-full max-w-[608px]">
        <Button
          variant="outline"
          className="flex-1 border-destructive text-destructive hover:bg-destructive/10"
          disabled={deleteCanceledMutation.isPending}
          onClick={() => setDeleteCanceledConfirmOpen(true)}
        >
          <Trash2Icon className="size-4" />
          Delete
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
          if (
            cancelConfirmOpen ||
            deleteConfirmOpen ||
            deleteCanceledConfirmOpen
          ) {
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
                // below and `door-knocking/native/turfLifecycle.ts`.
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
          ))
        }
      >
        {row && (
          <>
            {isPendingVerificationSms && (
              // Same banner as the SMS flow: the drawer is where a user
              // lands from the "Needs compliance" history row, so the
              // unblock action leads here too.
              <Alert variant="info" icon={<ShieldAlertIcon />}>
                <AlertTitle>Compliance needed before this can send</AlertTitle>
                <AlertDescription>
                  Carrier approval takes 1 to 2 weeks. Schedule now, start
                  compliance so your text clears in time.
                </AlertDescription>
                <AlertAction>
                  <Button
                    type="button"
                    variant="alertOutline"
                    onClick={startVerification}
                  >
                    <ShieldCheckIcon />
                    Start compliance
                  </Button>
                </AlertAction>
              </Alert>
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

            {isPaidFlowSms && (
              <DetailsSection title="Payment details">
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

      <AlertDialog
        open={deleteCanceledConfirmOpen}
        onOpenChange={setDeleteCanceledConfirmOpen}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this campaign?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes the canceled campaign from your history. This
              can&apos;t be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep campaign</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={deleteCanceledMutation.isPending}
              onClick={() => row && deleteCanceledMutation.mutate(row.id)}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
