'use client'

import { useState, type ReactNode } from 'react'
import Link from 'next/link'
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
  AlertTitle,
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Badge,
  Button,
  Card,
  Drawer,
  DrawerBody,
  DrawerClose,
  DrawerContent,
  DrawerFooter,
  DrawerHandle,
  DrawerHeader,
  DrawerTitle,
  Eyebrow,
  Progress,
  StatusText,
  Table,
  TableBody,
  TableCell,
  TableRow,
  XMarkIcon,
} from '@styleguide'
import {
  ArchiveIcon,
  CalendarIcon,
  CheckCircleIcon,
  ClockIcon,
  DollarSignIcon,
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

const PRICE_PER_TEXT =
  OUTREACH_OPTIONS.find((o) => o.type === OUTREACH_TYPES.text)?.cost ?? 0.035

interface OutreachDetailsDrawerProps {
  row: HistoryRow | null
  onOpenChange: (open: boolean) => void
  // CampaignVerify clearance state: while pending, scheduled SMS rows show
  // "Needs compliance" and the footer offers Cancel + Start verification.
  tcrCompliance?: TcrCompliance
}

// min-w-0 belongs on the card as well as the inner text span: `grid-cols-2`
// lays down minmax(0,1fr) tracks, but a grid item's own min-width stays `auto`,
// so anything the card can't shrink below still pushes past its track.
const Metric = ({
  icon,
  label,
  value,
}: {
  icon: ReactNode
  label: string
  value: string
}) => (
  <Card className="flex min-w-0 flex-row items-start gap-2 rounded-lg p-3">
    <span className="mt-0.5 shrink-0 text-muted-foreground [&_svg]:size-4">
      {icon}
    </span>
    <span className="min-w-0">
      <span className="block text-xs text-muted-foreground">{label}</span>
      <span className="block truncate text-sm font-medium text-foreground">
        {value}
      </span>
    </span>
  </Card>
)

// The canvas's Applied filters anatomy: a labelled pill group per dimension —
// "Audience" (the saved list this campaign was sent to) above "Filters" (the
// criteria that built it). Purely presentational, so plain Badges rather
// than toggle pills — nothing here should read as clickable.
const FilterGroup = ({
  title,
  values,
}: {
  title: string
  values: string[]
}) => (
  <div className="space-y-1.5">
    <p className="text-xs font-medium text-muted-foreground">{title}</p>
    <div className="flex flex-wrap gap-2">
      {values.map((label) => (
        <Badge
          key={label}
          shape="pill"
          className="border-border bg-transparent px-3 py-1.5 text-sm font-medium text-foreground"
        >
          {label}
        </Badge>
      ))}
    </div>
  </div>
)

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
  // Delete + Start verification.
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
    mutationFn: () => {
      const rowId = row?.id
      if (!rowId) return Promise.reject(new Error('row unavailable'))
      return clientRequest('POST /v1/outreach/:id/cancel', {
        id: String(rowId),
      })
    },
    onSuccess: ({ data }) => {
      setOutreaches(
        outreaches.map((o) =>
          o.id === row?.id ? { ...o, status: data.outreach.status } : o,
        ),
      )
      if (row?.id) {
        queryClient.invalidateQueries({
          queryKey: outreachDetailQueryKey(row.id),
        })
      }
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
    mutationFn: () => {
      const rowId = row?.id
      if (!rowId) return Promise.reject(new Error('row unavailable'))
      return clientRequest('DELETE /v1/outreach/:id', { id: String(rowId) })
    },
    onSuccess: () => {
      setOutreaches(outreaches.filter((o) => o.id !== row?.id))
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

  return (
    <Drawer open={row !== null} onOpenChange={onOpenChange} direction="bottom">
      <DrawerContent
        className="flex h-[calc(100dvh-4rem)] flex-col p-0 data-[vaul-drawer-direction=bottom]:mt-0 data-[vaul-drawer-direction=bottom]:max-h-[calc(100dvh-4rem)] data-[vaul-drawer-direction=bottom]:rounded-t-[10px] lg:h-[calc(100dvh-8rem)] lg:data-[vaul-drawer-direction=bottom]:max-h-[calc(100dvh-8rem)]"
        // The close lives inside the 608px content column (top right), not
        // on the sheet corner — same anatomy as the flow sheets.
        closeClassName="hidden"
      >
        <DrawerHandle />
        <DrawerHeader className="sr-only">
          <DrawerTitle>
            {row?.name || row?.title || 'Outreach details'}
          </DrawerTitle>
        </DrawerHeader>
        {row && (
          <>
            {/* Desktop top padding clears the close button, which sits inside
                the content column rather than on the sheet corner. */}
            <div className="border-b border-border px-4 pt-6 pb-4 lg:px-6 lg:pt-14">
              <div className="mx-auto flex w-full max-w-[608px] items-start justify-between gap-2">
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
                <DrawerClose className="inline-flex size-10 shrink-0 items-center justify-center rounded-full opacity-70 transition-opacity hover:opacity-100 focus-visible:ring-2 focus-visible:ring-primary-focus focus-visible:outline-none">
                  <XMarkIcon className="size-4" />
                  <span className="sr-only">Close</span>
                </DrawerClose>
              </div>
            </div>

            <DrawerBody className="flex-1 overflow-y-auto px-4 pb-6 lg:px-6">
              <div className="mx-auto w-full max-w-[608px] space-y-6">
                {isPendingVerificationSms && (
                  // Same banner as the SMS flow: the drawer is where a user
                  // lands from the "Needs compliance" history row, so the
                  // unblock action leads here too.
                  <Alert variant="info" icon={<ShieldAlertIcon />}>
                    <AlertTitle>
                      Compliance needed before this can send
                    </AlertTitle>
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
                  <section className="space-y-3">
                    <Eyebrow>Applied filters</Eyebrow>
                    {audienceName && (
                      <FilterGroup title="Audience" values={[audienceName]} />
                    )}
                    {audienceLabels.length > 0 && (
                      <FilterGroup title="Filters" values={audienceLabels} />
                    )}
                  </section>
                )}

                <section className="space-y-3">
                  <Eyebrow>Overview</Eyebrow>
                  <div className="grid grid-cols-2 gap-3">
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
                  </div>
                </section>

                {isPaidFlowSms && (
                  <section className="space-y-3">
                    <Eyebrow>Payment details</Eyebrow>
                    <div className="grid grid-cols-2 gap-3">
                      <Metric
                        icon={<DollarSignIcon />}
                        label="Total cost"
                        value={isFreeSms ? 'Free' : `$${totalCost.toFixed(2)}`}
                      />
                      <Metric
                        icon={<HashIcon />}
                        label="Cost per outreach"
                        value={
                          isFreeSms ? '—' : `$${PRICE_PER_TEXT.toFixed(3)}`
                        }
                      />
                    </div>
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
                  </section>
                )}

                {isSms && row.script && (
                  <section className="space-y-3">
                    <Eyebrow>Message</Eyebrow>
                    {/* The stored script is already the fully composed send
                        (greeting + body + opt-out footer) — render it
                        verbatim, line breaks included. */}
                    <Card className="rounded-lg p-3">
                      <p className="text-sm whitespace-pre-wrap text-foreground">
                        {row.script}
                      </p>
                    </Card>
                  </section>
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
                    We couldn&apos;t load this campaign&apos;s posts. Close and
                    try again.
                  </p>
                )}
                {social && (
                  <section className="space-y-3">
                    <Eyebrow>Posts · {social.assets.length}</Eyebrow>
                    <p className="text-sm text-muted-foreground">
                      The text created for each platform. Copy any post again
                      below.
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
                    We couldn&apos;t load this campaign&apos;s call progress.
                    Close and try again.
                  </p>
                )}

                {isPhoneBanking && phoneBanking && !isCompleted && (
                  <section className="space-y-3">
                    <Eyebrow>Progress</Eyebrow>
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
                      <div className="grid grid-cols-2 gap-3">
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
                      </div>
                    </Card>
                  </section>
                )}

                {isPhoneBanking && phoneBanking && !isCompleted && (
                  <section className="space-y-3">
                    <Eyebrow>Payment details</Eyebrow>
                    <div className="grid grid-cols-2 gap-3">
                      <Metric
                        icon={<DollarSignIcon />}
                        label="Total cost"
                        value="Free"
                      />
                      <Metric
                        icon={<HashIcon />}
                        label="Cost per outreach"
                        value="—"
                      />
                    </div>
                  </section>
                )}

                {isPhoneBanking && phoneBanking && isCompleted && (
                  <section className="space-y-3">
                    <Eyebrow>Results</Eyebrow>
                    <p className="text-sm text-muted-foreground">
                      Based on {phoneBanking.entriesCalled.toLocaleString()}{' '}
                      phone banking contacts
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
                  </section>
                )}
              </div>
            </DrawerBody>

            {isPhoneBanking && phoneBanking && !isCompleted && (
              <DrawerFooter className="shrink-0 border-t border-border px-4 py-4 lg:px-6">
                <div className="mx-auto flex w-full max-w-[608px] gap-3">
                  <Button asChild className="flex-1">
                    <Link
                      href={`/dashboard/outreach/phone-banking/${phoneBanking.listId}`}
                    >
                      <PhoneIcon className="size-4" />
                      Continue calling
                    </Link>
                  </Button>
                </div>
              </DrawerFooter>
            )}

            {isPendingVerificationSms ? (
              // Held-by-carriers rows: Delete rides the shipped cancel
              // machinery (same confirm, same endpoint — refund included);
              // the primary action is unblocking the send.
              <DrawerFooter className="shrink-0 border-t border-border px-4 py-4 lg:px-6">
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
              </DrawerFooter>
            ) : isCancelableSms ? (
              <DrawerFooter className="shrink-0 border-t border-border px-4 py-4 lg:px-6">
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
              </DrawerFooter>
            ) : isCanceled ? (
              <DrawerFooter className="shrink-0 border-t border-border px-4 py-4 lg:px-6">
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
              </DrawerFooter>
            ) : null}

            {/* Archive applies to every completed row (the history's
                Archive toggle filters all types); Delete stays
                phone-banking-only — it calls the list-delete endpoint. */}
            {isCompleted && (
              <DrawerFooter className="shrink-0 border-t border-border px-4 py-4 lg:px-6">
                <div className="mx-auto flex w-full max-w-[608px] gap-3">
                  {isPhoneBanking && phoneBanking && (
                    <Button
                      variant="ghost"
                      className="shrink-0 text-destructive hover:bg-destructive/10"
                      onClick={() => setDeleteConfirmOpen(true)}
                    >
                      <Trash2Icon className="size-4" />
                      Delete
                    </Button>
                  )}
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
              </DrawerFooter>
            )}
          </>
        )}
      </DrawerContent>

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
              onClick={() => cancelMutation.mutate()}
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
              onClick={() => deleteMutation.mutate()}
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
              onClick={() => deleteCanceledMutation.mutate()}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Drawer>
  )
}
