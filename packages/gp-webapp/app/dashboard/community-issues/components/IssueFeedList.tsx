'use client'

import { Badge, Skeleton } from '@styleguide'

type CommunityIssueFeedCard = {
  id: string
  list: string
  category: string
  priority: string
  title: string
  summary: string
  rank: number | null
  prioritized: boolean
}

type CommunityIssueFeedListResponse = {
  issues: CommunityIssueFeedCard[]
  refresh: {
    status: 'running' | 'completed' | 'failed'
    lastCompletedAt: string | null
  }
}

type Props = {
  topCommunity: CommunityIssueFeedListResponse
  trending: CommunityIssueFeedListResponse
}

const priorityVariant = (
  priority: string,
): { className: string; label: string } => {
  if (priority === 'high') {
    return {
      className: 'bg-destructive text-destructive-foreground',
      label: 'High',
    }
  }
  if (priority === 'medium') {
    return {
      className: 'bg-warning-background text-warning-dark',
      label: 'Medium',
    }
  }
  return {
    className: 'bg-success-background text-success-dark',
    label: 'Low',
  }
}

const IssueCard = ({
  issue,
  showRank,
}: {
  issue: CommunityIssueFeedCard
  showRank: boolean
}) => {
  const severity = priorityVariant(issue.priority)
  return (
    <div className="flex gap-3 rounded-lg border border-border bg-card p-4">
      {showRank && issue.rank !== null && (
        <span className="shrink-0 text-sm font-semibold text-muted-foreground">
          #{issue.rank}
        </span>
      )}
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline" className="text-xs font-medium">
            {issue.category}
          </Badge>
          <span
            className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium ${severity.className}`}
          >
            {severity.label}
          </span>
        </div>
        <p className="text-sm font-semibold text-foreground">{issue.title}</p>
        <p className="text-sm text-muted-foreground">{issue.summary}</p>
      </div>
    </div>
  )
}

const FeedSection = ({
  title,
  feed,
  showRank,
}: {
  title: string
  feed: CommunityIssueFeedListResponse
  showRank: boolean
}) => {
  const issues = showRank
    ? [...feed.issues]
        .filter((i) => i.rank !== null)
        .sort((a, b) => (a.rank ?? 0) - (b.rank ?? 0))
    : feed.issues

  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-base font-semibold text-foreground">{title}</h2>
      {issues.length === 0 && feed.refresh.status === 'running' ? (
        <div className="flex flex-col gap-3">
          <Skeleton className="h-20 w-full rounded-lg" />
          <Skeleton className="h-20 w-full rounded-lg" />
          <Skeleton className="h-20 w-full rounded-lg" />
        </div>
      ) : issues.length === 0 ? (
        <p className="text-sm text-muted-foreground">No issues found.</p>
      ) : (
        issues.map((issue) => (
          <IssueCard key={issue.id} issue={issue} showRank={showRank} />
        ))
      )}
    </section>
  )
}

export default function IssueFeedList({
  topCommunity,
  trending,
}: Props): React.JSX.Element {
  return (
    <div className="flex flex-col gap-8 p-6">
      <h1 className="text-2xl font-bold text-foreground">Community Issues</h1>
      <FeedSection title="Top community issues" feed={topCommunity} showRank />
      <FeedSection title="Trending" feed={trending} showRank={false} />
    </div>
  )
}
