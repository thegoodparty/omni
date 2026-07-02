'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { Badge, Button, Card, CardContent } from '@styleguide'
import {
  ArrowLeftIcon,
  CheckIcon,
  ChevronRightIcon,
} from '@styleguide/components/ui/icons'
import type {
  CommunityIssueDetail,
  CommunityIssueSource,
} from 'gpApi/api-endpoints'
import { SectionSourcePills, SourcesCollapsible } from '@shared/citations'
import type { SourceInput } from '@shared/briefings/displaySource'
import { EVENTS, trackEvent } from 'helpers/analyticsHelper'
import { priorityVariant } from './IssueCard'
import PrioritizeButton from './PrioritizeButton'
import IssuesNavHeader from './IssuesNavHeader'
import CommunityIssuesChatDock from './CommunityIssuesChatDock'

type Props = {
  issue: CommunityIssueDetail
  devPreview?: boolean
}

const toSource = (s: CommunityIssueSource): SourceInput => ({
  id: s.id,
  name: s.name,
  source_type: s.source_type,
  url: s.url ?? null,
  publisher: s.publisher ?? null,
  article_type: s.article_type ?? null,
  article_date: s.article_date ?? null,
  page_number: null,
  section_heading: null,
  retrieved_at: '',
  retrieved_text_or_snapshot: '',
})

const SectionHeading = ({ children }: { children: React.ReactNode }) => (
  <h3 className="text-sm font-bold uppercase tracking-wide text-foreground">
    {children}
  </h3>
)

const NextStepCard = ({
  href,
  title,
  description,
  onClick,
}: {
  href: string
  title: string
  description: string
  onClick?: () => void
}) => (
  <Link
    href={href}
    onClick={onClick}
    className="group flex items-start justify-between gap-3 rounded-lg border border-border p-4 transition-colors hover:bg-muted"
  >
    <span className="flex min-w-0 flex-col gap-1">
      <span className="text-sm font-semibold text-foreground">{title}</span>
      <span className="text-sm text-muted-foreground">{description}</span>
    </span>
    <ChevronRightIcon
      className="size-4 shrink-0 text-muted-foreground"
      aria-hidden
    />
  </Link>
)

const IssueDetail = ({ issue, devPreview }: Props): React.JSX.Element => {
  const contentRef = useRef<HTMLDivElement>(null)
  const [prioritized, setPrioritized] = useState(issue.prioritized)

  useEffect(() => {
    if (devPreview) return
    trackEvent(EVENTS.CommunityIssues.IssueDetailViewed, { issueId: issue.id })
  }, [issue.id, devPreview])

  const detail = issue.detail
  const severity = priorityVariant(issue.priority)
  const sources: SourceInput[] = detail ? detail.sources.map(toSource) : []
  const sourceById = new Map(sources.map((s) => [s.id, s]))

  return (
    <div className="flex min-h-screen flex-col">
      <IssuesNavHeader />

      <div className="border-b border-border bg-background">
        <div className="mx-auto flex w-full max-w-[640px] items-center justify-between gap-4 px-6 py-4">
          <div className="flex min-w-0 items-center gap-3">
            <Link
              href="/dashboard/community-issues"
              aria-label="Back to issues"
              className="flex size-8 shrink-0 items-center justify-center rounded-full border border-input bg-background text-foreground transition-colors hover:bg-muted"
            >
              <ArrowLeftIcon className="size-4" aria-hidden />
            </Link>
            <h1 className="text-base font-semibold text-foreground">
              Issue Details
            </h1>
            {prioritized ? (
              <span className="inline-flex shrink-0 items-center rounded-full bg-primary px-2.5 py-0.5 text-xs font-semibold text-primary-foreground">
                My priority
              </span>
            ) : null}
          </div>
          {!issue.archived && !devPreview ? (
            prioritized ? (
              <Button
                variant="outline"
                disabled
                icon={<CheckIcon aria-hidden />}
                className="shrink-0"
              >
                Added
              </Button>
            ) : (
              <PrioritizeButton
                issueId={issue.id}
                onPrioritized={() => setPrioritized(true)}
              />
            )
          ) : null}
        </div>
      </div>

      <div
        ref={contentRef}
        className="mx-auto flex w-full max-w-[640px] flex-col gap-4 px-6 pb-28 pt-6"
      >
        <Card>
          <CardContent className="flex flex-col gap-6">
            <div className="flex items-start justify-between gap-3">
              <h2 className="text-lg font-semibold text-foreground">
                {issue.title}
              </h2>
              <div className="flex shrink-0 items-center gap-2">
                {issue.archived ? (
                  <Badge
                    variant="outline"
                    className="text-xs text-muted-foreground"
                  >
                    Archived
                  </Badge>
                ) : null}
                <Badge className={severity.className}>{severity.label}</Badge>
              </div>
            </div>

            {!detail ? (
              <p className="text-sm text-muted-foreground">
                No detail available for this issue.
              </p>
            ) : (
              <>
                <section className="flex flex-col gap-2">
                  <SectionHeading>Overview</SectionHeading>
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
                    <SectionHeading>History</SectionHeading>
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
                    <SectionHeading>Notable quotes</SectionHeading>
                    <ul className="flex flex-col gap-4">
                      {detail.quotes.items.map((q, i) => (
                        <li key={i} className="flex flex-col gap-2">
                          <blockquote className="border-l-2 border-border pl-3">
                            <p className="text-sm italic leading-6 text-foreground">
                              {q.text}
                            </p>
                            {q.attribution ? (
                              <p className="mt-1 text-xs text-muted-foreground">
                                {q.attribution}
                              </p>
                            ) : null}
                          </blockquote>
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
                    <SectionHeading>Research &amp; data</SectionHeading>
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
                    <SectionHeading>Legislation</SectionHeading>
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
                  <div className="border-t border-border pt-4">
                    <SourcesCollapsible
                      sources={sources}
                      onExpand={() => undefined}
                    />
                  </div>
                ) : null}
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardContent className="flex flex-col gap-3">
            <SectionHeading>Next steps</SectionHeading>
            {issue.relatedBriefings.map((rb) => (
              <NextStepCard
                key={rb.briefingItemId}
                href={`/dashboard/briefings/${rb.meetingDate}`}
                title="Review the related meeting briefing"
                description={`Meeting on ${rb.meetingDate}`}
              />
            ))}
            <NextStepCard
              href="/dashboard/polls/create"
              title="Run a poll on this issue"
              description="Get defensible numbers from your constituents."
              onClick={() => {
                if (devPreview) return
                trackEvent(EVENTS.CommunityIssues.RunPollClicked, {
                  issueId: issue.id,
                })
              }}
            />
          </CardContent>
        </Card>
      </div>

      <CommunityIssuesChatDock
        anchorIssue={{
          id: issue.id,
          title: issue.title,
          summary: issue.summary,
        }}
        selectionContainerRef={contentRef}
      />
    </div>
  )
}

export default IssueDetail
