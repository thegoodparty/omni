import { Metadata } from 'next'
import { auth } from '@clerk/nextjs/server'
import { redirect } from 'next/navigation'
import { Box, Container, Heading } from '@radix-ui/themes'
import { PERMISSIONS } from '@/lib/permissions'
import { listBriefings } from './actions'
import { BriefingList } from './components/BriefingList'
import { BriefingsToolbar } from './components/BriefingsToolbar'
import { BriefingsPagination } from './components/BriefingsPagination'
import {
  DEFAULT_PER_PAGE,
  SEARCH_PARAMS,
  isDateRange,
  isReviewStatus,
  type DateRange,
} from './types'

export const metadata: Metadata = {
  title: 'Briefings | GP Admin',
  description: 'Review meeting briefings',
}

interface PageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

function firstValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value
}

export default async function Page({ searchParams }: PageProps) {
  const { has, orgId } = await auth()

  if (!has?.({ permission: PERMISSIONS.REVIEW_BRIEFINGS }) || !orgId) {
    redirect('/dashboard/users')
  }

  const params = await searchParams

  const pageParam = Number(firstValue(params[SEARCH_PARAMS.PAGE]))
  const currentPage =
    Number.isInteger(pageParam) && pageParam >= 1 ? pageParam : 1

  const query = firstValue(params[SEARCH_PARAMS.QUERY]) ?? ''

  const dateRangeParam = firstValue(params[SEARCH_PARAMS.DATE_RANGE])
  const dateRange: DateRange =
    dateRangeParam && isDateRange(dateRangeParam) ? dateRangeParam : 'All time'

  const reviewStatusParam = firstValue(params[SEARCH_PARAMS.REVIEW_STATUS])
  const reviewStatus =
    reviewStatusParam && isReviewStatus(reviewStatusParam)
      ? reviewStatusParam
      : undefined

  const offset = (currentPage - 1) * DEFAULT_PER_PAGE

  const result = await listBriefings({
    offset,
    limit: DEFAULT_PER_PAGE,
    q: query || undefined,
    dateRange: dateRange === 'All time' ? undefined : dateRange,
    reviewStatus,
  })

  return (
    <Container size="4">
      <Heading size="6" mb="4">
        Briefings
      </Heading>

      <Box mb="6">
        <BriefingsToolbar
          query={query}
          dateRange={dateRange}
          reviewStatus={reviewStatus}
        />
      </Box>

      <BriefingList briefings={result.data} />

      <BriefingsPagination meta={result.meta} currentPage={currentPage} />
    </Container>
  )
}
