'use client'

import {
  type LucideIcon,
  Activity,
  Calendar,
  CalendarClock,
  CheckCircle2,
  DollarSign,
  FileText,
  Footprints,
  Hash,
  Pencil,
  Phone,
  Radio,
  Receipt,
  Trash2,
  UserMinus,
  Users,
} from 'lucide-react'
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  Card,
  Drawer,
  DrawerBody,
  DrawerContent,
  DrawerHandle,
  DrawerHeader,
  DrawerTitle,
  FilterPill,
  FilterPillGroup,
  Progress,
  Separator,
  toast,
} from '@goodparty_org/styleguide'
import {
  type HistoryRow,
  CHANNEL_LABEL,
  computeOutcomes,
  fmtDateLong,
  fmtDateTime,
  fmtTime,
} from './data'
import { ChannelBadge } from './ChannelBadge'
import { StatusIndicator } from './StatusIndicator'
import { SectionLabel } from '../../components/SectionLabel'

// Local metric card (icon + label + value) built on DS Card — no DS metric
// component exists. See NEW_COMPONENTS.md.
const Metric = ({
  icon: Icon,
  label,
  value,
}: {
  icon: LucideIcon
  label: string
  value: string
}) => (
  <Card className="flex flex-row items-start gap-2 rounded-lg p-3">
    <Icon className="text-muted-foreground mt-0.5 size-4 shrink-0" />
    <div className="min-w-0">
      <dt className="text-muted-foreground text-xs">{label}</dt>
      <dd className="text-foreground truncate text-sm font-medium">{value}</dd>
    </div>
  </Card>
)

const FilterGroup = ({
  title,
  children,
}: {
  title: string
  children: React.ReactNode
}) => (
  <div className="space-y-1.5">
    <p className="text-muted-foreground text-xs font-medium">{title}</p>
    <div className="flex flex-wrap gap-1.5">{children}</div>
  </div>
)

const Header = ({ row }: { row: HistoryRow }) => {
  const byline = (() => {
    if (row.status === 'scheduled' && row.scheduledAt)
      return `Scheduled for ${fmtDateTime(row.scheduledAt)}`
    if (row.status === 'in-progress' && row.startedAt)
      return `Started ${fmtDateTime(row.startedAt)}`
    if (row.status === 'done' && row.startedAt && row.completedAt)
      return `Started ${fmtDateTime(row.startedAt)} · Completed ${fmtDateTime(row.completedAt)}`
    const dateVerb =
      row.status === 'scheduled'
        ? 'Scheduled for'
        : row.status === 'in-progress'
          ? 'Started'
          : 'Sent'
    return `${dateVerb} ${row.date}`
  })()
  return (
    <div>
      <div className="flex items-center gap-2">
        <h2 className="text-foreground text-base font-semibold">{row.name}</h2>
        <StatusIndicator status={row.status} />
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-1.5">
        <ChannelBadge channel={row.channel} />
        <span className="text-muted-foreground text-sm">· {byline}</span>
      </div>
    </div>
  )
}

const FiltersSection = ({ row }: { row: HistoryRow }) => (
  <section className="space-y-3">
    <SectionLabel>Applied filters</SectionLabel>
    <FilterGroup title="Audience">
      <FilterPillGroup type="multiple" value={[row.audienceName]}>
        <FilterPill value={row.audienceName}>{row.audienceName}</FilterPill>
      </FilterPillGroup>
    </FilterGroup>
    {row.audienceFilters.length > 0 && (
      <FilterGroup title="Filters">
        <FilterPillGroup type="multiple" value={row.audienceFilters}>
          {row.audienceFilters.map((v) => (
            <FilterPill key={v} value={v}>
              {v}
            </FilterPill>
          ))}
        </FilterPillGroup>
      </FilterGroup>
    )}
  </section>
)

const OverviewSection = ({ row }: { row: HistoryRow }) => (
  <section className="space-y-3">
    <SectionLabel>Overview</SectionLabel>
    {row.status === 'scheduled' && row.scheduledAt && (
      <Alert variant="info" icon={<CalendarClock />}>
        <AlertTitle>Scheduled to start</AlertTitle>
        <AlertDescription>
          {fmtDateLong(row.scheduledAt)} at {fmtTime(row.scheduledAt)}
        </AlertDescription>
      </Alert>
    )}
    <dl className="grid grid-cols-2 gap-3">
      {row.status === 'done' && row.startedAt && row.completedAt ? (
        <>
          <Metric
            icon={Calendar}
            label="Start"
            value={fmtDateTime(row.startedAt)}
          />
          <Metric
            icon={CheckCircle2}
            label="End"
            value={fmtDateTime(row.completedAt)}
          />
        </>
      ) : (
        <Metric icon={Calendar} label="Date" value={row.date} />
      )}
      <Metric icon={FileText} label="Name" value={row.name} />
      <Metric icon={Radio} label="Channel" value={CHANNEL_LABEL[row.channel]} />
      <Metric icon={Users} label="People" value={row.people.toLocaleString()} />
      <Metric
        icon={UserMinus}
        label="Unsubscribes"
        value={
          row.unsubscribes === null ? '—' : row.unsubscribes.toLocaleString()
        }
      />
    </dl>
  </section>
)

const ProgressSection = ({ row }: { row: HistoryRow }) => {
  const total = row.people
  const completed = row.responses ?? 0
  const remaining = Math.max(0, total - completed)
  const pct = total > 0 ? Math.round((completed / total) * 100) : 0
  return (
    <section className="space-y-3">
      <SectionLabel>Progress</SectionLabel>
      <Card className="gap-3 rounded-lg p-3">
        <div className="flex items-center justify-between">
          <span className="text-muted-foreground text-sm">
            {completed.toLocaleString()} of {total.toLocaleString()} reached
          </span>
          <span className="text-foreground text-sm font-medium">{pct}%</span>
        </div>
        <Progress value={pct} />
        <dl className="grid grid-cols-2 gap-3">
          <Metric
            icon={CheckCircle2}
            label="Completed"
            value={completed.toLocaleString()}
          />
          <Metric
            icon={Users}
            label="Remaining"
            value={remaining.toLocaleString()}
          />
        </dl>
      </Card>
    </section>
  )
}

const OutcomesSection = ({ row }: { row: HistoryRow }) => {
  const outcomes = computeOutcomes(row.channel, row.people)
  if (!outcomes) return null
  return (
    <section className="space-y-3">
      <SectionLabel>Results</SectionLabel>
      <Card className="gap-0 overflow-hidden rounded-lg p-0">
        <div className="text-muted-foreground flex items-center gap-2 px-3 py-2">
          <Activity className="size-4" />
          <p className="text-xs">
            Based on {row.people.toLocaleString()}{' '}
            {CHANNEL_LABEL[row.channel].toLowerCase()} contact
            {row.people === 1 ? '' : 's'}
          </p>
        </div>
        {outcomes.map((o) => (
          <div key={o.label}>
            <Separator />
            <div className="flex items-center justify-between gap-3 px-3 py-2">
              <dt className="text-foreground text-sm">{o.label}</dt>
              <dd className="text-foreground flex items-baseline gap-2 text-sm font-medium">
                <span className="w-[5ch] text-right tabular-nums">
                  {o.count.toLocaleString()}
                </span>
                <span className="text-muted-foreground w-[4ch] text-right text-xs font-normal tabular-nums">
                  {o.pct}%
                </span>
              </dd>
            </div>
          </div>
        ))}
      </Card>
    </section>
  )
}

const PaymentSection = ({ row }: { row: HistoryRow }) => {
  const isFree = row.cost <= 0
  return (
    <section className="space-y-3">
      <SectionLabel>Payment details</SectionLabel>
      <dl className="grid grid-cols-2 gap-3">
        <Metric
          icon={DollarSign}
          label="Total cost"
          value={isFree ? 'Free' : `$${row.cost.toFixed(2)}`}
        />
        <Metric
          icon={Hash}
          label="Cost per outreach"
          value={isFree ? '—' : `$${row.costPerOutreach.toFixed(3)}`}
        />
      </dl>
      {row.receiptId && (
        <Button
          variant="link"
          size="small"
          className="h-auto gap-1.5 px-0"
          onClick={() =>
            toast('Receipt coming soon', {
              description: `Receipt ${row.receiptId} will be available shortly.`,
            })
          }
        >
          <Receipt className="size-4" />
          View receipt
        </Button>
      )}
    </section>
  )
}

type Props = {
  open: boolean
  onOpenChange: (v: boolean) => void
  row: HistoryRow | null
  onDelete: () => void
}

export const CampaignDetailsDrawer = ({
  open,
  onOpenChange,
  row,
  onDelete,
}: Props) => {
  const isDrivable = row?.channel === 'phone-bank' || row?.channel === 'door'
  const isSocial = row?.channel === 'social'

  const handleDelete = () => {
    onDelete()
    toast('Scheduled campaign deleted', {
      description: row ? `${row.name} has been deleted.` : undefined,
    })
  }

  const handleEdit = () => {
    toast('Edit scheduled campaign', {
      description: row ? `Editing ${row.name}` : undefined,
    })
  }

  const handleSeeList = () => {
    toast('List view coming soon', {
      description: "This channel doesn't have a list view yet.",
    })
  }

  const footerMode: 'edit' | 'continue' | 'note' | 'done' | 'none' = !row
    ? 'none'
    : row.status === 'scheduled'
      ? 'edit'
      : row.status === 'in-progress'
        ? isDrivable
          ? 'continue'
          : 'note'
        : 'done'

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent className="flex h-[calc(100dvh-4rem)] flex-col p-0 data-[vaul-drawer-direction=bottom]:mt-0 data-[vaul-drawer-direction=bottom]:max-h-[calc(100dvh-4rem)] lg:h-[calc(100dvh-8rem)] lg:data-[vaul-drawer-direction=bottom]:max-h-[calc(100dvh-8rem)]">
        <DrawerHandle />
        <DrawerHeader className="sr-only">
          <DrawerTitle>{row?.name ?? 'Outreach details'}</DrawerTitle>
        </DrawerHeader>
        {row && (
          <>
            <div className="px-4 py-4 lg:px-6">
              <div className="mx-auto w-full max-w-[608px]">
                <Header row={row} />
              </div>
            </div>

            <DrawerBody className="flex-1 overflow-y-auto px-4 pb-6 lg:px-6">
              <div className="mx-auto w-full max-w-[608px] space-y-6">
                <FiltersSection row={row} />
                <OverviewSection row={row} />
                {row.status === 'in-progress' && <ProgressSection row={row} />}
                {row.status === 'done' && <OutcomesSection row={row} />}
                <PaymentSection row={row} />
              </div>
            </DrawerBody>

            {footerMode !== 'none' && (
              <div className="border-border bg-background shrink-0 border-t px-4 py-4 lg:px-6">
                <div className="mx-auto flex w-full max-w-[608px] gap-3">
                  {footerMode === 'edit' && (
                    <>
                      <Button variant="destructive" onClick={handleDelete}>
                        <Trash2 className="size-4" />
                        Delete
                      </Button>
                      <Button className="flex-1" onClick={handleEdit}>
                        <Pencil className="size-4" />
                        Edit campaign
                      </Button>
                    </>
                  )}
                  {footerMode === 'continue' && (
                    <Button className="flex-1">
                      {row.channel === 'phone-bank' ? (
                        <>
                          <Phone className="size-4" />
                          Continue calling
                        </>
                      ) : (
                        <>
                          <Footprints className="size-4" />
                          Continue knocking
                        </>
                      )}
                    </Button>
                  )}
                  {footerMode === 'note' && (
                    <p className="text-muted-foreground flex-1 text-center text-sm">
                      This campaign is sending automatically. No action needed.
                    </p>
                  )}
                  {footerMode === 'done' && (
                    <Button
                      className="flex-1"
                      disabled={isSocial}
                      onClick={isSocial ? undefined : handleSeeList}
                    >
                      {isSocial ? 'Show post' : 'Show results'}
                    </Button>
                  )}
                </div>
              </div>
            )}
          </>
        )}
      </DrawerContent>
    </Drawer>
  )
}
