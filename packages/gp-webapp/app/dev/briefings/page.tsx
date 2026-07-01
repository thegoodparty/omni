'use client'

import { useEffect, useState } from 'react'
import { Button } from '@styleguide'
import type { MeetingBriefingFull } from 'gpApi/generated/agent-job-contracts'
import {
  BRIEFING_EXECUTIVE_SUMMARY_CARD_PATH,
  BRIEFING_EXECUTIVE_SUMMARY_DOM_ID,
  BRIEFING_EXECUTIVE_SUMMARY_TITLE_PATH,
  briefingItemDomId,
} from '@shared/briefings/routes'
import ExecutiveSummaryCard from '../../dashboard/briefings/components/detail/ExecutiveSummaryCard'
import AgendaItemCard from '../../dashboard/briefings/components/detail/AgendaItemCard'
import AnnotationsScope from '../../dashboard/briefings/components/annotations/AnnotationsScope'

type GalleryEntry = { slug: string; artifact: MeetingBriefingFull }

const BriefingRender = ({ slug, artifact }: GalleryEntry) => (
  <AnnotationsScope
    meetingDate={slug}
    items={artifact.items}
    initialActiveCard={{
      key: BRIEFING_EXECUTIVE_SUMMARY_DOM_ID,
      jsonPath: BRIEFING_EXECUTIVE_SUMMARY_CARD_PATH,
      titleJsonPath: BRIEFING_EXECUTIVE_SUMMARY_TITLE_PATH,
      title: 'Executive Summary',
    }}
  >
    <div className="mx-auto flex w-full max-w-[820px] flex-col gap-4 p-4">
      <ExecutiveSummaryCard
        summary={artifact.executive_summary}
        agendaItemIds={artifact.items.map((item) => item.id)}
        domId={BRIEFING_EXECUTIVE_SUMMARY_DOM_ID}
      />
      {artifact.items.map((item, index) => {
        const isFeatured = item.tier === 'featured'
        return (
          <AgendaItemCard
            key={item.id}
            item={item}
            itemIndex={index}
            sources={artifact.sources}
            domId={briefingItemDomId(item.id)}
            meetingDate={slug}
            showFeedback={isFeatured}
            variant={isFeatured ? 'full' : 'whatToExpectOnly'}
          />
        )
      })}
    </div>
  </AnnotationsScope>
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

  return (
    <div className="flex min-h-svh flex-col bg-muted">
      <div className="sticky top-0 z-10 flex items-center justify-between gap-4 border-b border-border bg-card px-4 py-3">
        <div className="flex flex-col">
          <span className="text-sm font-semibold">
            Briefing {index + 1} of {entries.length}
          </span>
          <span className="font-mono text-xs text-muted-foreground">
            {current.slug}
          </span>
        </div>
        <div className="flex items-center gap-2">
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
      </div>
      <BriefingRender key={current.slug} {...current} />
    </div>
  )
}

export default DevBriefingGallery
