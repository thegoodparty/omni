'use client'

import { useEffect, useRef } from 'react'
import { useQuery } from '@tanstack/react-query'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import {
  Alert,
  AlertDescription,
  ArrowLeftIcon,
  Button,
  Spinner,
} from '@styleguide'
import DashboardLayout from 'app/dashboard/shared/DashboardLayout'
import { outreachProduct } from 'app/dashboard/outreach/util/outreachAnalytics'
import { EVENTS, trackEvent } from 'helpers/analyticsHelper'
import { ANALYTICS_CHANNEL } from '../../../../analytics'
import { whatWeHeardCopy } from '../../../../copy'
import {
  RETURN_PARAM,
  safeReturnPath,
  withReturnPath,
} from '../../../../returnPath'
import { reportQueryOptions, themeQueryOptions } from '../../../queries'
import { rankThemes } from '../../../components/ThemeGrid'
import ThemeDetails from './ThemeDetails'
import ThemeMemos from './ThemeMemos'
import ThemeSummary from './ThemeSummary'

interface ThemeDetailPageProps {
  outreachId: number
  themeId: string
  isServe: boolean
}

const ThemeDetailPage = ({
  outreachId,
  themeId,
  isServe,
}: ThemeDetailPageProps) => {
  const copy = whatWeHeardCopy(isServe)
  const themeQuery = useQuery(themeQueryOptions(themeId))
  const from = safeReturnPath(useSearchParams()?.get(RETURN_PARAM) ?? null)
  const theme = themeQuery.data
  // The report is cached from the page this was opened from; read off it,
  // the circle shows the card's number. Opened cold, the run's own rank
  // stands in until the report arrives.
  const reportQuery = useQuery(reportQueryOptions(outreachId))
  const reportIndex = rankThemes(reportQuery.data?.themes ?? []).findIndex(
    (summary) => summary.id === themeId,
  )
  const report = reportQuery.data
  const position = reportIndex >= 0 ? reportIndex + 1 : theme?.rank
  const viewed = useRef<string | null>(null)

  // Once per theme opened, when the report has said where it ranks, however
  // often the report polls after.
  useEffect(() => {
    if (!theme || !report || viewed.current === themeId) return
    viewed.current = themeId
    trackEvent(EVENTS.IssueCapture.ThemeViewed, {
      channel: ANALYTICS_CHANNEL[report.channel],
      themeRank: position,
      themeCount: report.themes.length,
      conversationCount: theme.conversationCount,
      product: outreachProduct(isServe),
    })
  }, [theme, report, themeId, position, isServe])

  return (
    <DashboardLayout
      pathname={
        isServe ? '/dashboard/constituent-outreach' : '/dashboard/outreach'
      }
      showAlert={false}
      // The theme's title, empty until it loads rather than a placeholder
      // that would flash and then change.
      navHeader={{ label: theme?.title ?? '' }}
    >
      {/* The report's own top bar and way back, the same as What we heard's,
          so the theme floats on the gray canvas below. */}
      <div className="-mx-2 -mt-2 flex shrink-0 items-center border-b border-border bg-background px-4 py-3 md:-mx-4 md:-mt-4 md:px-6">
        <Button asChild variant="ghost">
          {/* Reads "Back", and names the report it returns to for a screen
              reader. */}
          <Link
            href={withReturnPath(
              `/dashboard/issue-capture/${outreachId}`,
              from,
            )}
            aria-label={copy.back}
          >
            <ArrowLeftIcon className="size-4" aria-hidden />
            {copy.backLabel}
          </Link>
        </Button>
      </div>
      {/* Voter Data's content column, as on the report, inset 16px from the
          edge on a phone, the same as the bar above. */}
      <div className="mx-auto mt-8 flex w-full max-w-[560px] flex-col gap-6 px-2 pb-8 md:px-0">
        {theme ? (
          <>
            <ThemeSummary
              theme={theme}
              position={position ?? theme.rank}
              isServe={isServe}
            />
            <ThemeDetails theme={theme} isServe={isServe} />
            <ThemeMemos theme={theme} isServe={isServe} />
          </>
        ) : themeQuery.isError ? (
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

export default ThemeDetailPage
