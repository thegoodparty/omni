'use client'

import { useEffect } from 'react'
import Link from 'next/link'
import { Badge } from '@styleguide'
import type {
  CommunityIssueFeedDetail,
  CommunityIssueSource,
} from 'gpApi/api-endpoints'
import { SectionSourcePills, SourcesCollapsible } from '@shared/citations'
import type { Source } from '@shared/briefings/types'
import { EVENTS, trackEvent } from 'helpers/analyticsHelper'

type Props = {
  issue: CommunityIssueFeedDetail
}

const priorityVariant = (
  priority: string,
): { className: string; label: string } => {
  if (priority === 'high')
    return {
      className: 'bg-destructive text-destructive-foreground',
      label: 'High',
    }
  if (priority === 'medium')
    return {
      className: 'bg-warning-background text-warning-dark',
      label: 'Medium',
    }
  return { className: 'bg-success-background text-success-dark', label: 'Low' }
}

const toSource = (s: CommunityIssueSource): Source => ({
  id: s.id,
  name: s.name,
  source_type: s.source_type as Source['source_type'],
  url: s.url ?? null,
  publisher: s.publisher ?? null,
  article_type: (s.article_type ?? null) as Source['article_type'],
  article_date: s.article_date ?? null,
  page_number: null,
  section_heading: null,
  retrieved_at: '',
  retrieved_text_or_snapshot: '',
})

const IssueDetail = ({ issue }: Props): React.JSX.Element => {
  useEffect(() => {
    trackEvent(EVENTS.CommunityIssues.IssueDetailViewed, { issueId: issue.id })
  }, [issue.id])

  const detail = issue.detail
  const severity = priorityVariant(issue.priority)

  if (!detail) {
    return (
      <div className="p-6">
        <p className="text-sm text-muted-foreground">
          No detail available for this issue.
        </p>
      </div>
    )
  }

  const sources: Source[] = detail.sources.map(toSource)
  const sourceById = new Map(sources.map((s) => [s.id, s]))

  return (
    <article className="flex flex-col gap-6 p-6">
      <header className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline" className="text-xs font-medium">
            {issue.category}
          </Badge>
          <Badge className={severity.className}>{severity.label}</Badge>
        </div>
        <h1 className="text-2xl font-bold text-foreground">{issue.title}</h1>
        <p className="text-sm text-muted-foreground">{issue.summary}</p>
      </header>

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-bold uppercase tracking-wide text-foreground">
          Overview
        </h2>
        <p className="text-sm leading-6 text-foreground">
          {detail.overview.summary}
        </p>
        <SectionSourcePills
          sourceIds={detail.overview.source_ids}
          sourceById={sourceById}
        />
      </section>

      {detail.history ? (
        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-bold uppercase tracking-wide text-foreground">
            History
          </h2>
          <p className="text-sm leading-6 text-foreground">
            {detail.history.summary}
          </p>
          <SectionSourcePills
            sourceIds={detail.history.source_ids}
            sourceById={sourceById}
          />
        </section>
      ) : null}

      {detail.quotes ? (
        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-bold uppercase tracking-wide text-foreground">
            Notable quotes
          </h2>
          <ul className="flex flex-col gap-3">
            {detail.quotes.items.map((q, i) => (
              <li key={i} className="flex flex-col gap-1">
                <blockquote className="border-l-2 border-border pl-3 text-sm italic leading-6 text-foreground">
                  {q.text}
                </blockquote>
                {q.attribution ? (
                  <span className="text-xs text-muted-foreground">
                    {q.attribution}
                  </span>
                ) : null}
                <SectionSourcePills
                  sourceIds={[q.source_id]}
                  sourceById={sourceById}
                />
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {detail.research ? (
        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-bold uppercase tracking-wide text-foreground">
            Research & data
          </h2>
          <p className="text-sm leading-6 text-foreground">
            {detail.research.summary}
          </p>
          <SectionSourcePills
            sourceIds={detail.research.source_ids}
            sourceById={sourceById}
          />
        </section>
      ) : null}

      {detail.legislation ? (
        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-bold uppercase tracking-wide text-foreground">
            Legislation
          </h2>
          <p className="text-sm leading-6 text-foreground">
            {detail.legislation.summary}
          </p>
          <SectionSourcePills
            sourceIds={detail.legislation.source_ids}
            sourceById={sourceById}
          />
        </section>
      ) : null}

      {sources.length > 0 ? (
        <div className="border-y border-border py-2">
          <SourcesCollapsible sources={sources} />
        </div>
      ) : null}

      {issue.relatedBriefings.length > 0 ? (
        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-bold uppercase tracking-wide text-foreground">
            Related briefings
          </h2>
          <ul className="flex flex-col gap-2">
            {issue.relatedBriefings.map((rb) => (
              <li key={rb.briefingItemId}>
                <Link
                  href={`/dashboard/briefings/${rb.meetingDate}`}
                  className="text-sm text-info-600 hover:underline"
                >
                  {rb.meetingDate}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </article>
  )
}

export default IssueDetail
