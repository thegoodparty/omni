'use client'

import { useEffect, useState } from 'react'
import { Button } from '@styleguide'
import type { MeetingBriefingFull } from 'gpApi/generated/agent-job-contracts'
import type { Briefing, AwaitingBriefing } from '@shared/briefings/types'
import { formatBriefingMeetingDate } from '@shared/briefings/dateHelpers'
import {
  BRIEFING_EXECUTIVE_SUMMARY_CARD_PATH,
  BRIEFING_EXECUTIVE_SUMMARY_DOM_ID,
  BRIEFING_EXECUTIVE_SUMMARY_TITLE_PATH,
  briefingItemDomId,
} from '@shared/briefings/routes'
import DashboardLayout from '../../dashboard/shared/DashboardLayout'
import ExecutiveSummaryCard from '../../dashboard/briefings/components/detail/ExecutiveSummaryCard'
import AgendaItemCard from '../../dashboard/briefings/components/detail/AgendaItemCard'
import AnnotationsScope from '../../dashboard/briefings/components/annotations/AnnotationsScope'
import ActiveCardScrollSpy from '../../dashboard/briefings/components/detail/ActiveCardScrollSpy'
import DetailHeader from '../../dashboard/briefings/components/detail/DetailHeader'
import DetailToc from '../../dashboard/briefings/components/detail/DetailToc'
import MobileBottomBar from '../../dashboard/briefings/components/detail/MobileBottomBar'
import DesktopBottomBar from '../../dashboard/briefings/components/detail/DesktopBottomBar'
import ShareScope from '../../dashboard/briefings/components/detail/ShareScope'
import BriefingAwaitingPage from '../../dashboard/briefings/components/BriefingAwaitingPage'

type GalleryEntry = { slug: string; artifact: MeetingBriefingFull }

// Mirrors server.ts BRIEFING_TYPE_LABEL so the derived title matches prod. The
// artifact off S3 is a raw MeetingBriefingFull; the real Briefing type carries
// two fields gp-api augments at read time (title, briefing_id). An empty
// briefing_id makes ShareScope suppress the share UI — correct for local data.
const BRIEFING_TYPE_LABEL: Record<string, string> = {
  city_council_meeting: 'City Council meeting',
  county_legislature_meeting: 'County Legislature meeting',
  school_board_meeting: 'School Board meeting',
}

const toBriefing = (artifact: MeetingBriefingFull): Briefing => {
  const formattedDate = formatBriefingMeetingDate(artifact.meeting_date)
  return {
    ...artifact,
    briefing_id: '',
    title: `${
      BRIEFING_TYPE_LABEL[artifact.briefing_type] ?? 'Meeting'
    } briefing for ${formattedDate}`,
  }
}

const toAwaiting = (
  slug: string,
  artifact: MeetingBriefingFull,
): AwaitingBriefing => ({
  status: 'awaiting_agenda',
  slug,
  meetingName: artifact.meeting_name,
  meetingDate: formatBriefingMeetingDate(artifact.meeting_date),
  meetingTime: artifact.meeting_time ?? '',
  meetingTimezone: artifact.meeting_timezone ?? '',
  location: artifact.location ?? '',
  durationMinutes: 0,
})

const isFullArtifact = (artifact: MeetingBriefingFull): boolean =>
  artifact.briefing_status === 'briefing_ready' ||
  artifact.briefing_status === 'agenda_provided_by_user'

// Thin duplication of app/dashboard/briefings/[slug]/layout.tsx's inner JSX so a
// local artifact renders in the exact detail-page chrome (DetailHeader, TOC
// sidebar, two-column pane, bottom bars) without touching the real server-only
// layout (it calls serveAccess() + getBriefingBySlug()). Content components are
// the real ones, imported directly.
const FullBriefingView = ({ slug, artifact }: GalleryEntry) => {
  const briefing = toBriefing(artifact)
  return (
    <DashboardLayout
      pathname="/dashboard/briefings"
      showAlert={false}
      wrapperClassName="!p-0"
    >
      <AnnotationsScope
        meetingDate={slug}
        items={briefing.items}
        initialActiveCard={{
          key: BRIEFING_EXECUTIVE_SUMMARY_DOM_ID,
          jsonPath: BRIEFING_EXECUTIVE_SUMMARY_CARD_PATH,
          titleJsonPath: BRIEFING_EXECUTIVE_SUMMARY_TITLE_PATH,
          title: 'Executive Summary',
        }}
      >
        <ActiveCardScrollSpy items={briefing.items} />
        <ShareScope briefing={briefing}>
          <div className="relative">
            <div className="flex min-h-full flex-col bg-muted pb-20 lg:h-svh lg:min-h-0 lg:overflow-hidden lg:pb-20">
              <DetailHeader briefing={briefing} />

              <div className="mx-auto w-full max-w-[1120px] px-4 py-6 lg:flex lg:min-h-0 lg:flex-1 lg:flex-col lg:overflow-hidden lg:px-8">
                <div className="lg:flex lg:min-h-0 lg:flex-1 lg:items-stretch lg:gap-8 lg:overflow-hidden">
                  <aside className="hidden rounded-2xl border border-border bg-card p-3 lg:block lg:w-[260px] lg:shrink-0 lg:overflow-y-auto">
                    <DetailToc briefingSlug={slug} items={briefing.items} />
                  </aside>

                  <div
                    id="briefing-detail-pane"
                    data-briefing-scroll-container
                    style={{ WebkitTouchCallout: 'none' }}
                    className="flex flex-col gap-4 lg:min-h-0 lg:flex-1 lg:overflow-y-auto lg:p-0.5"
                  >
                    <ExecutiveSummaryCard
                      summary={briefing.executive_summary}
                      agendaItemIds={briefing.items.map((item) => item.id)}
                      domId={BRIEFING_EXECUTIVE_SUMMARY_DOM_ID}
                    />
                    {briefing.items.map((item, index) => {
                      const isFeatured = item.tier === 'featured'
                      return (
                        <AgendaItemCard
                          key={item.id}
                          item={item}
                          itemIndex={index}
                          sources={briefing.sources}
                          domId={briefingItemDomId(item.id)}
                          meetingDate={slug}
                          showFeedback={isFeatured}
                          variant={isFeatured ? 'full' : 'whatToExpectOnly'}
                        />
                      )
                    })}
                  </div>
                </div>
              </div>
            </div>

            <MobileBottomBar briefingSlug={slug} items={briefing.items} />
            <DesktopBottomBar />
          </div>
        </ShareScope>
      </AnnotationsScope>
    </DashboardLayout>
  )
}

const AwaitingBriefingView = ({ slug, artifact }: GalleryEntry) => (
  <DashboardLayout
    pathname="/dashboard/briefings"
    showAlert={false}
    wrapperClassName="!p-0"
  >
    <BriefingAwaitingPage briefing={toAwaiting(slug, artifact)} />
  </DashboardLayout>
)

const DevBriefingGallery = () => {
  const [entries, setEntries] = useState<GalleryEntry[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [index, setIndex] = useState(0)

  useEffect(() => {
    fetch('/api/dev/briefings')
      .then((res) => res.json())
      .then((data: { briefings?: GalleryEntry[] }) => {
        setEntries(data.briefings ?? [])
      })
      .catch((e) => setError(String(e)))
  }, [])

  if (process.env.NODE_ENV !== 'development') {
    return <p className="p-8">Not available in production.</p>
  }

  if (error) return <p className="p-8">Failed to load briefings: {error}</p>
  if (!entries) return <p className="p-8">Loading briefings…</p>
  if (entries.length === 0) {
    return (
      <p className="p-8">
        No briefings found. Drop <code>&lt;runId&gt;.json</code> artifact files
        into the <code>.local-briefings/</code> dir (or set{' '}
        <code>LOCAL_BRIEFINGS_DIR</code>) and reload.
      </p>
    )
  }

  const current = entries[Math.min(index, entries.length - 1)]
  if (!current) return null

  const View = isFullArtifact(current.artifact)
    ? FullBriefingView
    : AwaitingBriefingView

  return (
    <>
      {/* Floating cohort pager, above the replicated detail-page chrome. */}
      <div className="fixed left-1/2 top-2 z-[100] flex -translate-x-1/2 items-center gap-3 rounded-full border border-border bg-card px-3 py-1.5 shadow-lg">
        <span className="text-sm font-semibold">
          {index + 1} / {entries.length}
        </span>
        <span className="max-w-[220px] truncate font-mono text-xs text-muted-foreground">
          {current.slug}
        </span>
        <Button
          size="small"
          variant="secondary"
          disabled={index === 0}
          onClick={() => setIndex((i) => Math.max(0, i - 1))}
        >
          Previous
        </Button>
        <Button
          size="small"
          variant="secondary"
          disabled={index >= entries.length - 1}
          onClick={() => setIndex((i) => Math.min(entries.length - 1, i + 1))}
        >
          Next
        </Button>
      </div>
      <View key={current.slug} {...current} />
    </>
  )
}

export default DevBriefingGallery
