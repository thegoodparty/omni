'use client'

import { useEffect, useId, useRef } from 'react'
import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import type {
  FeedbackReportMemo,
  FeedbackReportResponse,
} from '@goodparty_org/contracts'
import {
  Alert,
  AlertDescription,
  ArrowLeftIcon,
  Button,
  Spinner,
} from '@styleguide'
import DashboardLayout from 'app/dashboard/shared/DashboardLayout'
import {
  fetchOutreachDetail,
  fetchServeOutreachDetail,
  useOutreachDetail,
} from 'app/dashboard/outreach/v2/useOutreachDetail'
import { EVENTS, trackEvent } from 'helpers/analyticsHelper'
import { outreachProduct } from 'app/dashboard/outreach/util/outreachAnalytics'
import { ANALYTICS_CHANNEL } from '../../analytics'
import { whatWeHeardCopy } from '../../copy'
import { reportQueryOptions } from '../queries'
import MemoList, { type MemoListItem } from './MemoList'
import NewTagsStrip from './NewTagsStrip'
import ReportCaption from './ReportCaption'
import SummarizeButton from './SummarizeButton'
import SummarizingBanner from './SummarizingBanner'
import ThemeGrid from './ThemeGrid'
import UnderFloorList from './UnderFloorList'

const toListItem = (memo: FeedbackReportMemo): MemoListItem => ({
  id: memo.id,
  transcript: memo.transcript,
  issues: memo.issues,
  actorName: memo.actorName,
  channel: memo.channel,
  occurredAt: memo.occurredAt,
  pending: memo.confirmedAt === null,
})

const EveryNote = ({
  memos,
  isServe,
}: {
  memos: MemoListItem[]
  isServe: boolean
}) => {
  const headingId = useId()
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-3">
      <h2 id={headingId} className="text-lg font-semibold text-foreground">
        {whatWeHeardCopy(isServe).everyNoteHeading}
      </h2>
      <MemoList memos={memos} isServe={isServe} />
    </section>
  )
}

// The four states, in the order they win. A run in flight beats everything,
// because whatever else is true is about to change. Under the floor beats a
// completed run, because counts are read live and a run's themes over
// notes that have since lost their confirmation would overstate them.
const ReportBody = ({
  report,
  outreachId,
  isServe,
}: {
  report: FeedbackReportResponse
  outreachId: number
  isServe: boolean
}) => {
  const copy = whatWeHeardCopy(isServe)
  const memos = report.memos.map(toListItem)
  const status = report.run?.status ?? null

  if (status === 'running') {
    return (
      <>
        <SummarizingBanner isServe={isServe} />
        <EveryNote memos={memos} isServe={isServe} />
      </>
    )
  }

  if (report.denominators.confirmed < report.floor) {
    return <UnderFloorList memos={memos} isServe={isServe} />
  }

  return (
    <>
      {status === 'failed' && (
        <Alert variant="destructive">
          <AlertDescription>{copy.failed}</AlertDescription>
        </Alert>
      )}
      {/* A failed run leaves the previous run's themes up, so these render
          for a failed run as well as a completed one. */}
      {report.themes.length > 0 && (
        <>
          {/* By the themes, not report.run, which can be failed or in
              flight while these come from the last completed run. */}
          <NewTagsStrip
            isServe={isServe}
            themeTagIds={report.themes.flatMap((theme) =>
              theme.tag?.status === 'proposed' ? [theme.tag.id] : [],
            )}
          />
          <ThemeGrid
            themes={report.themes}
            outreachId={outreachId}
            isServe={isServe}
          />
        </>
      )}
      <EveryNote memos={memos} isServe={isServe} />
    </>
  )
}

interface WhatWeHeardPageProps {
  outreachId: number
  isServe: boolean
}

const WhatWeHeardPage = ({ outreachId, isServe }: WhatWeHeardPageProps) => {
  const copy = whatWeHeardCopy(isServe)
  const reportQuery = useQuery(reportQueryOptions(outreachId))
  // The bar names the outreach the report is about, read and worded the way
  // the hub's history row and drawer name it.
  const outreach = useOutreachDetail(
    outreachId,
    true,
    isServe ? fetchServeOutreachDetail : fetchOutreachDetail,
  ).data
  const report = reportQuery.data
  const viewed = useRef(false)

  // Once per visit, on the first report, however often it polls after.
  useEffect(() => {
    if (!report || viewed.current) return
    viewed.current = true
    trackEvent(EVENTS.IssueCapture.ReportViewed, {
      scope: 'effort',
      channel: ANALYTICS_CHANNEL[report.channel],
      themeCount: report.themes.length,
      confirmedCount: report.denominators.confirmed,
      product: outreachProduct(isServe),
    })
  }, [report, isServe])

  return (
    <DashboardLayout
      pathname={
        isServe ? '/dashboard/constituent-outreach' : '/dashboard/outreach'
      }
      showAlert={false}
      // Empty until the outreach loads rather than a placeholder that would
      // flash and then change.
      navHeader={{
        label: outreach
          ? outreach.name || outreach.title || 'Untitled campaign'
          : '',
      }}
    >
      {/* The Voter Data page's full-bleed white top bar (the negative
          margins cancel the layout wrapper's padding), holding the way back
          and the page's action, so the report below floats on the gray
          canvas. */}
      <div className="-mx-2 -mt-2 flex h-14 shrink-0 items-center justify-between gap-4 border-b border-border bg-background px-4 md:-mx-4 md:-mt-4 md:px-6">
        {/* The CRM sheet's own Back. The Win hub reopens this effort's details when it is named in the
            URL, so the way back lands on the drawer the reader came from
            rather than the top of the list. Serve's hub takes no such
            parameter. */}
        <Button asChild variant="ghost" size="small" className="gap-1 px-2">
          {/* Reads "Back" like the CRM sheet's, and names the hub it
              returns to for a screen reader. */}
          <Link
            aria-label={copy.backToOutreach}
            href={
              isServe
                ? '/dashboard/constituent-outreach'
                : `/dashboard/outreach?outreachId=${outreachId}`
            }
          >
            <ArrowLeftIcon className="size-4" aria-hidden />
            {copy.backLabel}
          </Link>
        </Button>
        {/* The page's one action sits at the right of the bar, where Voter
            Data's Create new list sits. */}
        {report && report.run?.status !== 'running' && (
          <SummarizeButton
            outreachId={outreachId}
            report={report}
            reportUpdatedAt={reportQuery.dataUpdatedAt}
            isServe={isServe}
            underFloor={report.denominators.confirmed < report.floor}
          />
        )}
      </div>
      {/* Voter Data's content column, inset 16px from the edge on a phone,
          the same as the bar above. */}
      <div className="mx-auto mt-8 flex w-full max-w-[560px] flex-col gap-6 px-2 pb-8 md:px-0">
        {report ? (
          <div className="flex flex-col gap-6">
            <header className="flex min-w-0 flex-col gap-1">
              <h1 className="text-2xl font-semibold text-foreground">
                {report.question ?? copy.title}
              </h1>
              <ReportCaption
                denominators={report.denominators}
                outreachId={outreachId}
                isServe={isServe}
              />
            </header>
            <ReportBody
              report={report}
              outreachId={outreachId}
              isServe={isServe}
            />
          </div>
        ) : reportQuery.isError ? (
          <p className="text-sm text-destructive">{copy.loadFailed}</p>
        ) : (
          <div className="flex items-center justify-center gap-3 py-20">
            <Spinner />
            <p className="text-base text-foreground">{copy.loading}</p>
          </div>
        )}
      </div>
    </DashboardLayout>
  )
}

export default WhatWeHeardPage
