'use client'

import { useState, type ReactNode } from 'react'
import Link from 'next/link'
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
  Drawer,
  DrawerBody,
  DrawerClose,
  DrawerContent,
  DrawerFooter,
  DrawerHandle,
  DrawerHeader,
  DrawerTitle,
  Eyebrow,
  FilterPill,
  FilterPillGroup,
  Progress,
  StatusText,
  Table,
  TableBody,
  TableCell,
  TableRow,
  XMarkIcon,
} from '@styleguide'
import {
  CalendarIcon,
  CheckCircleIcon,
  ClockIcon,
  DollarSignIcon,
  FileTextIcon,
  Loader2Icon,
  Share2Icon,
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

interface OutreachDetailsDrawerProps {
  row: HistoryRow | null
  onOpenChange: (open: boolean) => void
}

const Metric = ({
  icon,
  label,
  value,
}: {
  icon: ReactNode
  label: string
  value: string
}) => (
  <Card className="flex flex-row items-start gap-2 rounded-lg p-3">
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

interface DetailRow extends HistoryRow {
  voterFileFilter?: VoterFileFilters
}

export const OutreachDetailsDrawer = ({
  row,
  onOpenChange,
}: OutreachDetailsDrawerProps) => {
  const isSocial = row?.outreachType === OUTREACH_TYPES.socialMedia
  const isPhoneBanking = row?.outreachType === OUTREACH_TYPES.nativePhoneBanking
  const detailQuery = useOutreachDetail(row?.id ?? null, row !== null)
  const social = detailQuery.data?.social
  const phoneBanking = detailQuery.data?.phoneBanking
  const isCompleted = row?.status === 'completed'

  const [outreaches, setOutreaches] = useOutreach()
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false)
  const { errorSnackbar } = useSnackbar()
  const deleteMutation = useMutation({
    mutationFn: () =>
      clientRequest('DELETE /v1/phone-banking/lists/:id', {
        id: String(phoneBanking?.listId),
      }),
    onSuccess: () => {
      setOutreaches(outreaches.filter((o) => o.id !== row?.id))
      setDeleteConfirmOpen(false)
      onOpenChange(false)
    },
    onError: () =>
      errorSnackbar("Couldn't delete this list. Please try again."),
  })

  const displayDate = row?.date ?? row?.createdAt
  const audienceLabels = formatAudienceLabels(
    (row as DetailRow | null)?.voterFileFilter || {},
  )
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
            <div className="px-4 py-4 lg:px-6">
              <div className="mx-auto flex w-full max-w-[608px] items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <h2 className="text-base font-semibold text-foreground">
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
                <DrawerClose className="inline-flex size-10 shrink-0 items-center justify-center rounded-full opacity-70 transition-opacity hover:opacity-100 focus-visible:ring-2 focus-visible:ring-primary-focus focus-visible:outline-none">
                  <XMarkIcon className="size-4" />
                  <span className="sr-only">Close</span>
                </DrawerClose>
              </div>
            </div>

            <DrawerBody className="flex-1 overflow-y-auto px-4 pb-6 lg:px-6">
              <div className="mx-auto w-full max-w-[608px] space-y-6">
                {audienceLabels.length > 0 && (
                  <section className="space-y-3">
                    <Eyebrow>Applied filters</Eyebrow>
                    <div className="space-y-1.5">
                      <p className="text-xs font-medium text-muted-foreground">
                        Filters
                      </p>
                      <FilterPillGroup type="multiple" value={audienceLabels}>
                        {audienceLabels.map((label) => (
                          <FilterPill key={label} value={label}>
                            {label}
                          </FilterPill>
                        ))}
                      </FilterPillGroup>
                    </div>
                  </section>
                )}

                <section className="space-y-3">
                  <Eyebrow>Overview</Eyebrow>
                  <div className="grid grid-cols-2 gap-3">
                    <Metric
                      icon={<CalendarIcon />}
                      label="Date"
                      value={
                        displayDate ? dateUsHelper(displayDate, 'long') : '—'
                      }
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
                  </div>
                </section>

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
                    <p className="text-sm font-medium text-foreground">
                      {phoneBanking.peopleCalled.toLocaleString()} of{' '}
                      {phoneBanking.peopleTotal.toLocaleString()} reached
                    </p>
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
                        icon={<DollarSignIcon />}
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
              <DrawerFooter className="border-t border-border">
                <Button asChild className="w-full">
                  <Link
                    href={`/dashboard/outreach/phone-banking/${phoneBanking.listId}`}
                  >
                    Continue calling
                  </Link>
                </Button>
              </DrawerFooter>
            )}

            {isPhoneBanking && phoneBanking && isCompleted && (
              <DrawerFooter className="border-t border-border">
                <Button
                  variant="destructive"
                  className="w-full"
                  onClick={() => setDeleteConfirmOpen(true)}
                >
                  Delete
                </Button>
              </DrawerFooter>
            )}
          </>
        )}
      </DrawerContent>

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
    </Drawer>
  )
}
