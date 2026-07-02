'use client'

import { useEffect, useMemo, useState, type MouseEvent } from 'react'
import Link from 'next/link'
import { Badge, Button } from '@styleguide'
import type {
  CommunityIssueCard,
  CommunityIssueDetail,
  CommunityIssueSource,
} from 'gpApi/api-endpoints'
import type { GalleryEntry, Issue, IssueArtifact, IssueSource } from './types'
import IssueFeedList from '../../dashboard/community-issues/components/IssueFeedList'
import IssueDetail from '../../dashboard/community-issues/components/IssueDetail'

const LIST_LABEL: Record<IssueArtifact['list'], string> = {
  top_community: 'Top community',
  trending: 'Trending',
}

const dataQualityVariant = (
  quality: IssueArtifact['data_quality'],
): 'default' | 'soft' | 'destructive' => {
  if (quality === 'ok') return 'default'
  if (quality === 'partial') return 'soft'
  return 'destructive'
}

// The artifact off S3 has no issue ids, so we synthesize a stable one from the
// existing feed id (when the issue already lives in the feed) or the rank. It
// only has to be unique within one artifact and slash-free — the feed's issue
// links encode it in the href, which the viewer parses back to open detail.
const issueId = (issue: Issue): string =>
  issue.existing_issue_id ?? `rank-${issue.rank}`

const toSource = (s: IssueSource): CommunityIssueSource => ({
  id: s.id,
  name: s.name,
  source_type: s.source_type,
  url: s.url ?? null,
  publisher: s.publisher ?? null,
  article_type: s.article_type ?? null,
  article_date: s.article_date ?? null,
})

const toCard = (issue: Issue, list: string): CommunityIssueCard => ({
  id: issueId(issue),
  list,
  category: issue.category,
  priority: issue.priority,
  title: issue.title,
  summary: issue.summary,
  rank: issue.rank,
  prioritized: false,
})

const toDetail = (issue: Issue, list: string): CommunityIssueDetail => ({
  ...toCard(issue, list),
  archived: false,
  detail: {
    sources: issue.detail.sources.map(toSource),
    overview: issue.detail.overview,
    history: issue.detail.history,
    quotes: issue.detail.quotes,
    research: issue.detail.research,
    legislation: issue.detail.legislation,
  },
  relatedBriefings: [],
  priorityId: null,
})

const makeFeed = (issues: CommunityIssueCard[]) => ({
  issues,
  refresh: { status: 'completed' as const, lastCompletedAt: null },
})

const ISSUES_BASE = '/dashboard/community-issues'

// Renders a single artifact through the production Serve UI: the feed list an
// elected official lands on, then the full issue detail when they click through.
// The prod components hardcode next/link navigation to real dashboard routes; a
// capture-phase handler intercepts those and drives local view state instead, so
// the viewer stays self-contained (next/link bails when defaultPrevented).
const ArtifactView = ({ entry }: { entry: GalleryEntry }) => {
  const { artifact } = entry
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const cards = useMemo(
    () =>
      [...artifact.issues]
        .sort((a, b) => a.rank - b.rank)
        .map((issue) => toCard(issue, artifact.list)),
    [artifact],
  )

  const selectedIssue = useMemo(
    () =>
      artifact.issues.find((issue) => issueId(issue) === selectedId) ?? null,
    [artifact, selectedId],
  )

  const feed = makeFeed(cards)
  const empty = makeFeed([])
  const topCommunity = artifact.list === 'top_community' ? feed : empty
  const trending = artifact.list === 'trending' ? feed : empty

  const handleClickCapture = (e: MouseEvent<HTMLDivElement>) => {
    const anchor = (e.target as HTMLElement).closest('a')
    const href = anchor?.getAttribute('href') ?? ''
    if (!href.startsWith(ISSUES_BASE)) return
    e.preventDefault()
    const rest = href.slice(ISSUES_BASE.length).replace(/^\//, '')
    const id = rest === '' ? null : decodeURIComponent(rest.split('/')[0] ?? '')
    if (id !== null && !artifact.issues.some((i) => issueId(i) === id)) {
      setNotice('Only issue detail pages are viewable in the artifact viewer.')
      return
    }
    setNotice(null)
    setSelectedId(id)
  }

  return (
    <div onClickCapture={handleClickCapture}>
      {notice ? (
        <p className="mx-auto w-full max-w-[640px] px-6 pt-3 text-sm text-muted-foreground">
          {notice}
        </p>
      ) : null}
      {selectedIssue ? (
        <IssueDetail issue={toDetail(selectedIssue, artifact.list)} />
      ) : (
        <IssueFeedList
          topCommunity={topCommunity}
          trending={trending}
          hideStaffControls
        />
      )}
    </div>
  )
}

const DevIssueGallery = () => {
  const [entries, setEntries] = useState<GalleryEntry[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [index, setIndex] = useState(0)

  useEffect(() => {
    if (process.env.NODE_ENV !== 'development') return
    fetch('/api/dev/issues')
      .then((res) => res.json())
      .then((data: { issues?: GalleryEntry[] }) =>
        setEntries(data.issues ?? []),
      )
      .catch((e) => setError(String(e)))
  }, [])

  if (process.env.NODE_ENV !== 'development') {
    return <p className="p-8">Not available in production.</p>
  }

  if (error) return <p className="p-8">Failed to load issues: {error}</p>
  if (!entries) return <p className="p-8">Loading issues…</p>
  if (entries.length === 0) {
    return (
      <p className="p-8">
        No issue artifacts found. Pull some with{' '}
        <code>scripts/pull-local-issues.sh --latest 10</code> (or set{' '}
        <code>LOCAL_ISSUES_DIR</code>) and reload.
      </p>
    )
  }

  const current = entries[Math.min(index, entries.length - 1)]
  if (!current) return null

  return (
    <>
      {/* Floating cohort pager, above the issue body. */}
      <div className="fixed left-1/2 top-2 z-[100] flex -translate-x-1/2 items-center gap-3 rounded-full border border-border bg-card px-3 py-1.5 shadow-lg">
        <span className="text-sm font-semibold">
          {index + 1} / {entries.length}
        </span>
        <span className="max-w-[220px] truncate font-mono text-xs text-muted-foreground">
          {current.artifact.organization_slug}
        </span>
        <Badge variant="secondary">{LIST_LABEL[current.artifact.list]}</Badge>
        <Badge variant={dataQualityVariant(current.artifact.data_quality)}>
          {current.artifact.data_quality}
        </Badge>
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
        <Link
          href={`/dev/runs/${current.runId}?from=issues`}
          className="rounded-full border border-border px-3 py-1 text-sm font-semibold underline"
        >
          View agent run
        </Link>
      </div>
      <ArtifactView key={current.runId} entry={current} />
    </>
  )
}

export default DevIssueGallery
