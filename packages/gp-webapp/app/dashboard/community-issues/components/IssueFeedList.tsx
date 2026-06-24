'use client'

import { Badge, Skeleton } from '@styleguide'
import type { CommunityIssueCard } from 'gpApi/api-endpoints'
import StaffDispatchButtons from './StaffDispatchButtons'

type CommunityIssueListResponse = {
  issues: CommunityIssueCard[]
  refresh: {
    status: 'running' | 'completed' | 'failed'
    lastCompletedAt: string | null
  }
}

type Props = {
  topCommunity: CommunityIssueListResponse
  trending: CommunityIssueListResponse
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
  issue: CommunityIssueCard
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
          <Badge className={severity.className}>{severity.label}</Badge>
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
  feed: CommunityIssueListResponse
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

const IssueFeedList = ({
  topCommunity,
  trending,
}: Props): React.JSX.Element => {
  return (
    <div className="flex flex-col gap-8 p-6">
      <h1 className="text-2xl font-bold text-foreground">Community Issues</h1>
      <StaffDispatchButtons />
      <FeedSection title="Top community issues" feed={topCommunity} showRank />
      <FeedSection title="Trending" feed={trending} showRank={false} />
    </div>
  )
}

export default IssueFeedList
