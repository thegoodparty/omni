'use client'

import { useEffect, useId, useRef, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
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
import { RETURN_PARAM, safeReturnPath } from '../../returnPath'
import { reportQueryOptions } from '../queries'
import DownloadNotesLink from './DownloadNotesLink'
import MemoList, { type MemoListItem } from './MemoList'
import ReportCounts from './ReportCounts'
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

// The newest five, the rest behind Show more, so the notes do not push the
// page into a scroll of every conversation the effort had. The download is
// the whole list either way.
const VISIBLE_NOTES = 5

const EveryNote = ({
  memos,
  channel,
  outreachId,
  isServe,
}: {
  memos: MemoListItem[]
  channel: FeedbackReportResponse['channel']
  outreachId: number
  isServe: boolean
}) => {
  const copy = whatWeHeardCopy(isServe)
  const headingId = useId()
  const [expanded, setExpanded] = useState(false)
  // A text send lists every reply, as it shipped.
  const shown =
    expanded || channel === 'text' ? memos : memos.slice(0, VISIBLE_NOTES)
  const hidden = memos.length - shown.length
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <h2 id={headingId} className="text-lg font-semibold text-foreground">
          {copy.everyNoteHeading(channel)}
        </h2>
        {/* The export is the canvassers' notes; a text send's replies are
            already a file on the results page that received them. */}
        {channel !== 'text' && (
          <DownloadNotesLink
            outreachId={outreachId}
            hasNotes={memos.length > 0}
            isServe={isServe}
          />
        )}
      </div>
      <MemoList memos={shown} channel={channel} isServe={isServe} />
      {hidden > 0 && (
        <div className="mt-1 flex justify-center">
          <Button
            variant="outline"
            size="small"
            onClick={() => setExpanded(true)}
          >
            {copy.showMoreNotes(hidden)}
          </Button>
        </div>
      )}
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
        <EveryNote
          memos={memos}
          channel={report.channel}
          outreachId={outreachId}
          isServe={isServe}
        />
      </>
    )
  }

  if (report.denominators.confirmed < report.floor) {
    return (
      <UnderFloorList
        floor={report.floor}
        memos={memos}
        channel={report.channel}
        outreachId={outreachId}
        isServe={isServe}
      />
    )
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
        <ThemeGrid
          themes={report.themes}
          outreachId={outreachId}
          isServe={isServe}
        />
      )}
      <EveryNote
        memos={memos}
        channel={report.channel}
        outreachId={outreachId}
        isServe={isServe}
      />
    </>
  )
}

interface WhatWeHeardPageProps {
  outreachId: number
  isServe: boolean
}

const WhatWeHeardPage = ({ outreachId, isServe }: WhatWeHeardPageProps) => {
  const copy = whatWeHeardCopy(isServe)
  // Where the link that opened the report was pressed, if it said.
  const from = safeReturnPath(useSearchParams()?.get(RETURN_PARAM) ?? null)
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
        {/* The CRM sheet's own Back, to the page the report was opened from
            when the link said (a phone list, a turf). Otherwise the hub: the
            Win hub reopens this effort's details when it is named in the
            URL, so the way back lands on the drawer the reader came from.
            Serve's hub takes no such parameter. */}
        <Button asChild variant="ghost" size="small">
          {/* Reads "Back" like the CRM sheet's, and names the hub it
              returns to for a screen reader. */}
          <Link
            aria-label={from === null ? copy.backToOutreach : copy.backLabel}
            href={
              from ??
              (isServe
                ? '/dashboard/constituent-outreach'
                : `/dashboard/outreach?outreachId=${outreachId}`)
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
            <header className="flex min-w-0 flex-col gap-4">
              <h1 className="text-2xl font-semibold text-foreground">
                {report.question ?? copy.title}
              </h1>
              <ReportCounts
                denominators={report.denominators}
                channel={report.channel}
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
          <Alert variant="destructive" role="alert">
            <AlertDescription>{copy.loadFailed}</AlertDescription>
          </Alert>
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
