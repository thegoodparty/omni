'use client'

import { useQuery } from '@tanstack/react-query'
import Link from 'next/link'
import { ArrowLeftIcon, Button, Spinner } from '@styleguide'
import DashboardLayout from 'app/dashboard/shared/DashboardLayout'
import { whatWeHeardCopy } from '../../../../copy'
import { themeQueryOptions } from '../../../queries'
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
  const theme = themeQuery.data

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
      <div className="-mx-2 -mt-2 flex h-14 shrink-0 items-center border-b border-border bg-background px-4 md:-mx-4 md:-mt-4 md:px-6">
        <Button asChild variant="ghost" size="small" className="gap-1 px-2">
          {/* Reads "Back", and names the report it returns to for a screen
              reader. */}
          <Link
            href={`/dashboard/issue-capture/${outreachId}`}
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
            <ThemeSummary theme={theme} isServe={isServe} />
            <ThemeDetails theme={theme} isServe={isServe} />
            <ThemeMemos theme={theme} isServe={isServe} />
          </>
        ) : themeQuery.isError ? (
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

export default ThemeDetailPage
