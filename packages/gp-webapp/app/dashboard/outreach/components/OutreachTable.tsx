'use client'
import { OUTREACH_TYPE_MAPPING } from 'app/dashboard/outreach/constants'
import { dateUsHelper } from 'helpers/dateHelper'
import SimpleTable from '@shared/utils/SimpleTable'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import H4 from '@shared/typography/H4'
import { GradientOverlay } from '@shared/GradientOverlay'
import { StackedChips } from '@shared/utils/StackedChips'
import { formatAudienceLabels } from 'app/dashboard/outreach/util/formatAudienceLabels.util'
import { ActualViewAudienceFiltersModal } from 'app/dashboard/outreach/components/ViewAudienceFiltersModal'
import { convertAudienceFiltersForModal } from 'app/dashboard/outreach/util/convertAudienceFiltersForModal.util'
import { OutreachActions } from 'app/dashboard/outreach/components/OutreachActions'
import {
  useOutreach,
  Outreach,
} from 'app/dashboard/outreach/hooks/OutreachContext'
import { EVENTS, trackEvent } from 'helpers/analyticsHelper'
import { useP2pUxEnabled } from 'app/dashboard/components/tasks/flows/hooks/P2pUxEnabledProvider'
import { VoterFileFilters } from 'helpers/types'

interface OutreachRow extends Outreach {
  p2pJob?: { status?: string }
  voterFileFilter?: VoterFileFilters
}

interface OutreachTableProps {
  mockOutreaches?: OutreachRow[]
  // ENG-10769: the activity feed's "View outreach" link carries
  // ?outreachId=<id>; the server page parses it and threads it here so the
  // table can scroll to and highlight that campaign's row.
  highlightOutreachId?: number
}

const HIGHLIGHT_MS = 4000

interface PopoverPosition {
  top: number
  left: number
}

const NotApplicableLabel = () => <span className="text-gray-500">n/a</span>

type StatusKey =
  | 'pending'
  | 'approved'
  | 'denied'
  | 'paid'
  | 'in_progress'
  | 'completed'
  | 'pending_payment'

const statusLabels: { [K in StatusKey]: string } = {
  pending: 'Draft',
  approved: 'In review',
  denied: 'Denied',
  paid: 'Scheduled',
  in_progress: 'Scheduled',
  completed: 'Sent',
  pending_payment: 'Pending payment',
}

const isStatusKey = (key: string | null | undefined): key is StatusKey => {
  return key !== null && key !== undefined && key in statusLabels
}

const getP2pStatusLabel = (row: OutreachRow): string | null => {
  // Check if this is a P2P outreach by checking for phoneListId
  // (phoneListId indicates it was created via P2P flow, even if type is normalized to 'text')
  if (row.phoneListId == null) {
    return null
  }

  const { p2pJob, status } = row

  // Need both p2pJob status and outreach status to display
  if (!p2pJob?.status || !status || !isStatusKey(status)) {
    return null
  }

  // If P2P job is active, show as completed; otherwise use the outreach status
  const displayStatus: StatusKey =
    p2pJob.status === 'active' ? 'completed' : status
  return statusLabels[displayStatus]
}

// ENG-10769: rows without a phone list (robocall, legacy text) have no Peerly
// job, but their Outreach record still carries a real status — a scheduled
// robocall rendered "n/a" forever. `pending` here means "request submitted,
// fulfilled by the Political Assistant", not an unfinished draft, so it maps
// to "In review" rather than the p2p map's "Draft".
const nonP2pStatusLabels: { [K in StatusKey]: string } = {
  pending: 'In review',
  approved: 'In review',
  denied: 'Denied',
  paid: 'Scheduled',
  in_progress: 'Scheduled',
  completed: 'Sent',
  pending_payment: 'Pending payment',
}

const getStatusLabel = (row: OutreachRow): string | null => {
  if (row.phoneListId != null) {
    return getP2pStatusLabel(row)
  }
  const { status } = row
  if (!status || !isStatusKey(status)) {
    return null
  }
  return nonP2pStatusLabels[status]
}

const STATUS_COLUMN = {
  header: 'Status',
  cell: ({ row }: { row: OutreachRow }) => {
    const statusLabel = getStatusLabel(row)
    // Return null to indicate no status available, which will render as "n/a"
    if (!statusLabel) {
      return <NotApplicableLabel />
    }
    return <span className="capitalize">{statusLabel}</span>
  },
}

export const OutreachTable = ({
  mockOutreaches = [],
  highlightOutreachId,
}: OutreachTableProps) => {
  const { p2pUxEnabled } = useP2pUxEnabled()
  const [outreaches] = useOutreach()
  const useMockData = !outreaches?.length
  const tableData: OutreachRow[] = useMockData ? mockOutreaches : outreaches
  const [viewFilters, setViewFilters] = useState<VoterFileFilters | null>(null)
  const [actOnOutreach, setActOnOutreach] = useState<OutreachRow | null>(null)
  const [popoverPosition, setPopoverPosition] = useState<PopoverPosition>({
    top: 0,
    left: 0,
  })
  const popoverRef = useRef<HTMLDivElement>(null)
  const title = useMockData ? 'How your outreach could look' : 'Your campaigns'
  const router = useRouter()

  // Consume-once (ENG-10762 conventions): the id is captured into state
  // because the strip's router.replace re-runs the force-dynamic page's
  // server render without the param, reverting the prop to undefined. The
  // ref keeps an already-consumed id from re-highlighting on later renders
  // while still accepting a new deep link that arrives while mounted.
  const [highlightedId, setHighlightedId] = useState<number | null>(null)
  const consumedHighlightRef = useRef<number | undefined>(undefined)

  useEffect(() => {
    if (
      highlightOutreachId === undefined ||
      highlightOutreachId === consumedHighlightRef.current
    ) {
      return
    }
    consumedHighlightRef.current = highlightOutreachId
    router.replace('/dashboard/outreach', { scroll: false })
    // An id that no longer resolves (deleted or hidden outreach) falls back
    // to the plain list — param stripped, nothing highlighted, no error.
    if (!outreaches?.some((o) => o.id === highlightOutreachId)) {
      return
    }
    setHighlightedId(highlightOutreachId)
    document
      .getElementById(`outreach-row-${highlightOutreachId}`)
      ?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    const timer = setTimeout(() => setHighlightedId(null), HIGHLIGHT_MS)
    return () => clearTimeout(timer)
  }, [highlightOutreachId, outreaches, router])

  const getChannelLabel = (outreachType?: string): string => {
    if (!outreachType) return ''
    const mappedLabel =
      OUTREACH_TYPE_MAPPING[outreachType as keyof typeof OUTREACH_TYPE_MAPPING]
    return (
      mappedLabel ||
      outreachType.charAt(0).toUpperCase() + outreachType.slice(1)
    )
  }

  const formatVoterCount = (
    count: number | null | undefined,
  ): string | null => {
    if (count == null) return null
    return Number(count).toLocaleString()
  }

  const columns = useMemo(
    () => [
      {
        header: 'Date',
        cell: ({ row }: { row: OutreachRow }) =>
          row.date ? dateUsHelper(row.date, 'long') : <NotApplicableLabel />,
      },
      {
        header: 'Channel',
        cell: ({ row }: { row: OutreachRow }) =>
          getChannelLabel(row.outreachType),
      },
      {
        header: 'Audience',
        cell: ({ row }: { row: OutreachRow }) => {
          const audienceLabels = formatAudienceLabels(row.voterFileFilter || {})
          if (!audienceLabels.length) {
            return <NotApplicableLabel />
          }

          const firstThreeLabels = audienceLabels.slice(0, 3)
          return (
            <span className="flex flex-row items-center relative">
              <StackedChips
                {...{
                  labels: audienceLabels,
                  onClick: (_labels: string[], e: React.MouseEvent) => {
                    e.stopPropagation()
                    setViewFilters(row.voterFileFilter || null)
                  },
                }}
              />
              {audienceLabels.length > 0 && (
                <span
                  className="relative ml-2"
                  style={{
                    left: `${(firstThreeLabels.length - 1) * 0.25}rem`,
                  }}
                >
                  ({audienceLabels.length})
                </span>
              )}
            </span>
          )
        },
      },
      {
        header: 'Voters',
        cell: ({ row }: { row: OutreachRow }) => {
          const formattedCount = formatVoterCount(
            row.voterFileFilter?.voterCount,
          )
          return formattedCount ? formattedCount : <NotApplicableLabel />
        },
      },
      ...(p2pUxEnabled ? [STATUS_COLUMN] : []),
    ],
    [p2pUxEnabled, setViewFilters],
  )

  const convertedFilters = useMemo(
    () => viewFilters && convertAudienceFiltersForModal(viewFilters),
    [viewFilters],
  )

  const calculatePopoverPosition = (
    clientX?: number,
    clientY?: number,
  ): PopoverPosition => ({
    top: (clientY ?? 0) + 10,
    left: (clientX ?? 0) + 10,
  })

  const handleRowClick = (
    outreach: OutreachRow,
    { clientX, clientY }: { clientX?: number; clientY?: number } = {},
  ) => {
    setActOnOutreach(outreach)
    setPopoverPosition(calculatePopoverPosition(clientX, clientY))
  }

  const handlePopoverClose = () => {
    setActOnOutreach(null)
    setPopoverPosition({ top: 0, left: 0 })
  }

  const handleActionClick = (action: string) => {
    trackEvent(EVENTS.Outreach.ActionClicked, {
      outreachId: actOnOutreach?.id,
      medium: actOnOutreach?.outreachType,
      action,
    })
    setActOnOutreach(null)
  }

  useEffect(() => {
    if (!actOnOutreach) return
    const handleClickOutside = (e: MouseEvent) => {
      if (
        popoverRef.current &&
        !popoverRef.current.contains(e.target as Node)
      ) {
        handlePopoverClose()
      }
    }
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        handlePopoverClose()
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [actOnOutreach])

  // Sort table data by date, placing entries without a date at the end
  const sortedTableData = useMemo(() => {
    return [...tableData].sort((a, b) => {
      // Both have dates: sort by date (oldest first)
      if (a.date && b.date) {
        return new Date(a.date).getTime() - new Date(b.date).getTime()
      }
      // Only a has date: a comes first
      if (a.date) return -1
      // Only b has date: b comes first
      if (b.date) return 1
      // Neither has date: maintain order
      return 0
    })
  }, [tableData])

  const table = (
    <SimpleTable
      columns={columns}
      data={sortedTableData}
      onRowClick={handleRowClick}
      rowId={(row) => `outreach-row-${row.id}`}
      rowClassName={(row) =>
        row.id === highlightedId
          ? 'bg-primary/5 transition-colors duration-1000'
          : 'transition-colors duration-1000'
      }
    />
  )

  return (
    <section className="mt-4 mb-32">
      <H4 className="mb-4">{title}</H4>
      {useMockData ? (
        <GradientOverlay>{table}</GradientOverlay>
      ) : (
        <>
          {table}
          {actOnOutreach && (
            <div
              ref={popoverRef}
              className="fixed z-50 bg-white rounded-md border border-gray-200 shadow-md p-2"
              style={{ top: popoverPosition.top, left: popoverPosition.left }}
            >
              <OutreachActions
                {...{
                  outreach: actOnOutreach,
                  onClick: handleActionClick,
                }}
              />
            </div>
          )}
        </>
      )}
      <ActualViewAudienceFiltersModal
        open={Boolean(viewFilters)}
        audienceFilters={convertedFilters ?? undefined}
        onClose={() => setViewFilters(null)}
      />
    </section>
  )
}
