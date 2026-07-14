'use client'

import { useEffect } from 'react'
import Link from 'next/link'
import { EVENTS, trackEvent } from 'helpers/analyticsHelper'
import { Skeleton } from '@styleguide'
import { ChevronRightIcon } from '@styleguide/components/ui/icons'
import type { CommunityIssueCard } from 'gpApi/api-endpoints'
import IssueCard, { issueHref } from './IssueCard'
import IssuesNavHeader from './IssuesNavHeader'
import CommunityIssuesChatDock from './CommunityIssuesChatDock'
import CommunityIssuesDispatchBanner from './CommunityIssuesDispatchBanner'
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
  devPreview?: boolean
}

const SectionHeader = ({
  title,
  subtitle,
}: {
  title: string
  subtitle: string
}) => (
  <header className="flex flex-col gap-0.5">
    <h2 className="text-base font-semibold text-foreground">{title}</h2>
    <p className="text-sm text-muted-foreground">{subtitle}</p>
  </header>
)

const Loading = () => (
  <div className="flex flex-col gap-3">
    <Skeleton className="h-24 w-full rounded-lg" />
    <Skeleton className="h-24 w-full rounded-lg" />
    <Skeleton className="h-24 w-full rounded-lg" />
  </div>
)

const TrendingCard = ({ feed }: { feed: CommunityIssueListResponse }) => {
  if (feed.issues.length === 0 && feed.refresh.status === 'running') {
    return <Loading />
  }
  if (feed.issues.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">No trending issues yet.</p>
    )
  }
  return (
    <div className="overflow-hidden rounded-lg border border-border bg-card">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <span className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-foreground">
          <span className="relative flex size-2">
            <span className="absolute inline-flex size-full animate-ping rounded-full bg-info-600 opacity-75" />
            <span className="relative inline-flex size-2 rounded-full bg-info-600" />
          </span>
          Trending now
        </span>
        <Link
          href="/dashboard/community-issues/trending"
          className="text-sm font-semibold text-info-600"
        >
          View all
        </Link>
      </div>
      <div className="divide-y divide-border">
        {feed.issues.map((issue) => (
          <Link
            key={issue.id}
            href={issueHref(issue.id)}
            className="flex w-full items-center gap-3 px-4 py-3 transition-colors hover:bg-muted"
          >
            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="text-sm font-semibold text-foreground">
                {issue.title}
              </span>
              <span className="truncate text-sm text-muted-foreground">
                {issue.summary}
              </span>
            </span>
            <ChevronRightIcon
              className="size-4 shrink-0 text-muted-foreground"
              aria-hidden
            />
          </Link>
        ))}
      </div>
    </div>
  )
}

const TopSection = ({ feed }: { feed: CommunityIssueListResponse }) => {
  const issues = [...feed.issues]
    .filter((i) => i.rank !== null)
    .sort((a, b) => (a.rank ?? 0) - (b.rank ?? 0))

  return (
    <section className="flex flex-col gap-3">
      <SectionHeader
        title="Top community issues"
        subtitle="The highest priority issues that need solving."
      />
      {issues.length === 0 && feed.refresh.status === 'running' ? (
        <Loading />
      ) : issues.length === 0 ? (
        <p className="text-sm text-muted-foreground">No issues found.</p>
      ) : (
        <div className="overflow-hidden rounded-lg border border-border bg-card">
          <div className="divide-y divide-border">
            {issues.map((issue) => (
              <IssueCard key={issue.id} issue={issue} />
            ))}
            <Link
              href="/dashboard/community-issues/all"
              className="flex items-center justify-end gap-1 p-4 text-sm font-semibold text-info-600 transition-colors hover:bg-muted"
            >
              View all issues
              <ChevronRightIcon className="size-4" aria-hidden />
            </Link>
          </div>
        </div>
      )}
    </section>
  )
}

const IssueFeedList = ({
  topCommunity,
  trending,
  devPreview,
}: Props): React.JSX.Element => {
  useEffect(() => {
    if (devPreview) return
    trackEvent(EVENTS.CommunityIssues.ListViewed, {
      topCount: topCommunity.issues.length,
      trendingCount: trending.issues.length,
    })
  }, [topCommunity.issues.length, trending.issues.length])

  return (
    <div className="flex min-h-screen flex-col">
      <IssuesNavHeader />
      <div className="mx-auto flex w-full max-w-[640px] flex-col gap-8 px-6 pb-28 pt-6">
        {devPreview ? null : (
          <CommunityIssuesDispatchBanner
            initiallyRunning={
              topCommunity.refresh.status === 'running' ||
              trending.refresh.status === 'running'
            }
          />
        )}
        {devPreview ? null : <StaffDispatchButtons />}
        <section className="flex flex-col gap-3">
          <SectionHeader
            title="Trending community issues"
            subtitle="A quick glance at issues gaining momentum."
          />
          <TrendingCard feed={trending} />
        </section>
        <TopSection feed={topCommunity} />
      </div>
      <CommunityIssuesChatDock />
    </div>
  )
}

export default IssueFeedList
