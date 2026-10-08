'use client'

import { useQuery } from '@tanstack/react-query'
import { Alert, AlertDescription, Spinner } from '@styleguide'
import Paper from '@shared/utils/Paper'
import DashboardLayout from 'app/dashboard/shared/DashboardLayout'
import { whatWeHeardCopy } from '../../../../copy'
import { themeQueryOptions } from '../../../queries'
import ThemeDetails from './ThemeDetails'
import ThemeMemos from './ThemeMemos'
import ThemeTitle from './ThemeTitle'

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
    >
      <Paper className="min-h-full">
        {theme ? (
          <div className="flex flex-col gap-6">
            <ThemeTitle
              theme={theme}
              outreachId={outreachId}
              isServe={isServe}
            />
            <ThemeDetails theme={theme} isServe={isServe} />
            <ThemeMemos theme={theme} isServe={isServe} />
          </div>
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
      </Paper>
    </DashboardLayout>
  )
}

export default ThemeDetailPage
