'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import type { PaginationMeta } from '@/shared/gpApi'
import { Pagination } from '@/components/Pagination'
import { DEFAULT_PER_PAGE, SEARCH_PARAMS } from '../types'

interface JobDeadLettersPaginationProps {
  meta: PaginationMeta
  currentPage: number
}

export function JobDeadLettersPagination({
  meta,
  currentPage,
}: JobDeadLettersPaginationProps) {
  const router = useRouter()
  const searchParams = useSearchParams()

  const pushPage = (page: number) => {
    const params = new URLSearchParams(searchParams.toString())
    if (page <= 1) {
      params.delete(SEARCH_PARAMS.PAGE)
    } else {
      params.set(SEARCH_PARAMS.PAGE, String(page))
    }
    const queryString = params.toString()
    router.push(
      `/dashboard/job-dead-letters${queryString ? `?${queryString}` : ''}`
    )
  }

  return (
    <Pagination
      meta={meta}
      currentPage={currentPage}
      perPage={DEFAULT_PER_PAGE}
      onPageChange={pushPage}
      onPerPageChange={() => undefined}
    />
  )
}
