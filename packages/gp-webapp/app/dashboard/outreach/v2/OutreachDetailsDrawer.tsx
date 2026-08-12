'use client'

import type { ReactNode } from 'react'
import {
  Card,
  Drawer,
  DrawerBody,
  DrawerContent,
  DrawerHandle,
  DrawerHeader,
  DrawerTitle,
  Eyebrow,
  FilterPill,
  FilterPillGroup,
  StatusText,
} from '@styleguide'
import {
  CalendarIcon,
  FileTextIcon,
  Loader2Icon,
  Share2Icon,
  UsersRoundIcon,
} from '@styleguide/components/ui/icons'
import { dateUsHelper } from 'helpers/dateHelper'
import type { VoterFileFilters } from 'helpers/types'
import { formatAudienceLabels } from 'app/dashboard/outreach/util/formatAudienceLabels.util'
import { OUTREACH_TYPES } from 'app/dashboard/outreach/constants'
import { ChannelBadge, HistoryStatusText, getChannelLabel } from './channelMeta'
import { getHistoryStatusLabel, type HistoryRow } from './historyStatus.util'
import { useOutreachDetail } from './useOutreachDetail'
import { SocialAssetCard } from './SocialAssetCards'
import { socialPurposeLabel } from './socialPurposes'

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
  const detailQuery = useOutreachDetail(row?.id ?? null, row !== null)
  const social = detailQuery.data?.social

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
      : statusLabel === 'Sent'
        ? 'Sent'
        : null

  return (
    <Drawer open={row !== null} onOpenChange={onOpenChange} direction="bottom">
      <DrawerContent className="flex h-[calc(100dvh-4rem)] flex-col p-0 data-[vaul-drawer-direction=bottom]:mt-0 data-[vaul-drawer-direction=bottom]:max-h-[calc(100dvh-4rem)] data-[vaul-drawer-direction=bottom]:rounded-t-[10px] lg:h-[calc(100dvh-8rem)] lg:data-[vaul-drawer-direction=bottom]:max-h-[calc(100dvh-8rem)]">
        <DrawerHandle />
        <DrawerHeader className="sr-only">
          <DrawerTitle>
            {row?.name || row?.title || 'Outreach details'}
          </DrawerTitle>
        </DrawerHeader>
        {row && (
          <>
            <div className="px-4 py-4 lg:px-6">
              <div className="mx-auto w-full max-w-[608px]">
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
              </div>
            </DrawerBody>
          </>
        )}
      </DrawerContent>
    </Drawer>
  )
}
