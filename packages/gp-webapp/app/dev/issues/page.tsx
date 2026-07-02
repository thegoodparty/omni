'use client'

import { useEffect, useState } from 'react'
import { Badge } from '@styleguide'
import type { GalleryEntry, Issue, IssueArtifact, IssueSource } from './types'

const LIST_LABEL: Record<IssueArtifact['list'], string> = {
  top_community: 'Top community',
  trending: 'Trending',
}

const CATEGORY_LABEL: Record<Issue['category'], string> = {
  infrastructure_and_transportation: 'Infrastructure & transportation',
  public_safety: 'Public safety',
  education: 'Education',
  housing_and_development: 'Housing & development',
  health_and_human_services: 'Health & human services',
  economic_development: 'Economic development',
  quality_of_life: 'Quality of life',
  government_operations: 'Government operations',
  other: 'Other',
}

const dataQualityVariant = (
  quality: IssueArtifact['data_quality'],
): 'default' | 'soft' | 'destructive' => {
  if (quality === 'ok') return 'default'
  if (quality === 'partial') return 'soft'
  return 'destructive'
}

const priorityVariant = (
  priority: Issue['priority'],
): 'default' | 'secondary' | 'soft' => {
  if (priority === 'high') return 'default'
  if (priority === 'medium') return 'secondary'
  return 'soft'
}

const SourceRow = ({ source }: { source: IssueSource }) => (
  <li className="flex flex-col gap-0.5 border-b border-border py-2 text-sm last:border-b-0">
    <div className="flex flex-wrap items-center gap-2">
      <span className="font-mono text-xs text-muted-foreground">
        {source.id}
      </span>
      {source.url ? (
        <a
          href={source.url}
          target="_blank"
          rel="noreferrer"
          className="font-medium text-primary underline"
        >
          {source.name}
        </a>
      ) : (
        <span className="font-medium">{source.name}</span>
      )}
      <Badge variant="outline">{source.source_type}</Badge>
    </div>
    <div className="flex flex-wrap gap-x-3 text-xs text-muted-foreground">
      {source.publisher ? <span>{source.publisher}</span> : null}
      {source.article_date ? <span>{source.article_date}</span> : null}
      {source.article_type ? <span>{source.article_type}</span> : null}
    </div>
  </li>
)

const Subsection = ({
  title,
  summary,
  sourceIds,
}: {
  title: string
  summary?: string
  sourceIds?: string[]
}) => {
  if (!summary) return null
  return (
    <div className="flex flex-col gap-1">
      <h4 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </h4>
      <p className="whitespace-pre-wrap text-sm">{summary}</p>
      {sourceIds && sourceIds.length > 0 ? (
        <p className="font-mono text-xs text-muted-foreground">
          {sourceIds.join(', ')}
        </p>
      ) : null}
    </div>
  )
}

const IssueBlock = ({ issue }: { issue: Issue }) => (
  <div className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4">
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-sm font-semibold text-muted-foreground">
        #{issue.rank}
      </span>
      <h3 className="text-lg font-semibold">{issue.title}</h3>
    </div>
    <div className="flex flex-wrap gap-2">
      <Badge variant="soft">{CATEGORY_LABEL[issue.category]}</Badge>
      <Badge variant={priorityVariant(issue.priority)}>
        {issue.priority} priority
      </Badge>
      {issue.existing_issue_id ? (
        <Badge variant="outline">existing: {issue.existing_issue_id}</Badge>
      ) : null}
    </div>
    <p className="text-sm">{issue.summary}</p>

    <Subsection
      title="Overview"
      summary={issue.detail.overview?.summary}
      sourceIds={issue.detail.overview?.source_ids}
    />
    <Subsection
      title="History"
      summary={issue.detail.history?.summary}
      sourceIds={issue.detail.history?.source_ids}
    />
    <Subsection
      title="Research"
      summary={issue.detail.research?.summary}
      sourceIds={issue.detail.research?.source_ids}
    />
    <Subsection
      title="Legislation"
      summary={issue.detail.legislation?.summary}
      sourceIds={issue.detail.legislation?.source_ids}
    />

    {issue.detail.quotes && issue.detail.quotes.items.length > 0 ? (
      <div className="flex flex-col gap-2">
        <h4 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Quotes
        </h4>
        {issue.detail.quotes.items.map((quote, i) => (
          <blockquote
            key={i}
            className="border-l-2 border-border pl-3 text-sm italic"
          >
            “{quote.text}”
            <span className="mt-1 block text-xs not-italic text-muted-foreground">
              {quote.attribution ? `${quote.attribution} · ` : ''}
              {quote.source_id}
            </span>
          </blockquote>
        ))}
      </div>
    ) : null}

    {issue.detail.sources.length > 0 ? (
      <div className="flex flex-col gap-1">
        <h4 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Sources ({issue.detail.sources.length})
        </h4>
        <ul className="flex flex-col">
          {issue.detail.sources.map((source) => (
            <SourceRow key={source.id} source={source} />
          ))}
        </ul>
      </div>
    ) : null}
  </div>
)

const DetailPane = ({ entry }: { entry: GalleryEntry }) => {
  const { artifact, runId } = entry
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2 border-b border-border pb-4">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-xl font-semibold">
            {artifact.organization_slug}
          </h2>
          <Badge variant="secondary">{LIST_LABEL[artifact.list]}</Badge>
          <Badge variant={dataQualityVariant(artifact.data_quality)}>
            {artifact.data_quality}
          </Badge>
        </div>
        <p className="font-mono text-xs text-muted-foreground">{runId}</p>
        {artifact.data_quality_reason ? (
          <p className="text-sm text-muted-foreground">
            {artifact.data_quality_reason}
          </p>
        ) : null}
        {artifact.notes ? (
          <p className="text-sm text-muted-foreground">{artifact.notes}</p>
        ) : null}
      </div>

      {artifact.issues.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No issues in this artifact.
        </p>
      ) : (
        [...artifact.issues]
          .sort((a, b) => a.rank - b.rank)
          .map((issue) => <IssueBlock key={issue.rank} issue={issue} />)
      )}
    </div>
  )
}

const DevIssueGallery = () => {
  const [entries, setEntries] = useState<GalleryEntry[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [index, setIndex] = useState(0)

  useEffect(() => {
    fetch('/api/dev/issues')
      .then((res) => res.json())
      .then((data: { issues?: GalleryEntry[] }) => {
        setEntries(data.issues ?? [])
      })
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
    <div className="flex min-h-svh bg-muted">
      <aside className="w-80 shrink-0 overflow-y-auto border-r border-border bg-card">
        <div className="border-b border-border px-4 py-3 text-sm font-semibold">
          {entries.length} artifact{entries.length === 1 ? '' : 's'}
        </div>
        <ul>
          {entries.map((entry, i) => (
            <li key={entry.runId}>
              <button
                type="button"
                onClick={() => setIndex(i)}
                className={`flex w-full flex-col items-start gap-1 border-b border-border px-4 py-3 text-left ${
                  i === index ? 'bg-muted' : 'hover:bg-muted'
                }`}
              >
                <span className="font-medium">
                  {entry.artifact.organization_slug}
                </span>
                <span className="flex flex-wrap items-center gap-1">
                  <Badge variant="secondary">
                    {LIST_LABEL[entry.artifact.list]}
                  </Badge>
                  <Badge
                    variant={dataQualityVariant(entry.artifact.data_quality)}
                  >
                    {entry.artifact.data_quality}
                  </Badge>
                </span>
                <span className="max-w-full truncate font-mono text-xs text-muted-foreground">
                  {entry.runId}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </aside>
      <main className="flex-1 overflow-y-auto px-6 py-6">
        <DetailPane entry={current} />
      </main>
    </div>
  )
}

export default DevIssueGallery
