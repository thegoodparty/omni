'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import type { PaginationMeta } from '@goodparty_org/sdk'
import { Pagination } from '@/components/Pagination'
import {
  DEFAULT_PER_PAGE,
  type PerPageOption,
} from '@/app/dashboard/users/types'
import { SEARCH_PARAMS } from '../types'

interface BriefingsPaginationProps {
  meta: PaginationMeta
  currentPage: number
}

export function BriefingsPagination({
  meta,
  currentPage,
}: BriefingsPaginationProps) {
  const router = useRouter()
  const searchParams = useSearchParams()

  function pushPage(page: number) {
    const params = new URLSearchParams(searchParams.toString())
    if (page <= 1) {
      params.delete(SEARCH_PARAMS.PAGE)
    } else {
      params.set(SEARCH_PARAMS.PAGE, String(page))
    }
    const queryString = params.toString()
    router.push(`/dashboard/briefings${queryString ? `?${queryString}` : ''}`)
  }

  return (
    <Pagination
      meta={meta}
      currentPage={currentPage}
      perPage={DEFAULT_PER_PAGE as PerPageOption}
      onPageChange={pushPage}
      onPerPageChange={() => undefined}
    />
  )
}
