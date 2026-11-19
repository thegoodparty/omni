'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Box, Container, Heading, Text } from '@radix-ui/themes'
import type { BackgroundAgentRunListItem, PaginationMeta } from '@/shared/gpApi'
import { LoadingSpinner } from '@/components/LoadingSpinner'
import { Pagination } from '@/components/Pagination'
import {
  DEFAULT_PER_PAGE,
  PerPageOption,
  isPerPageOption,
} from '@/app/dashboard/users/types'
import { searchBackgroundAgentRuns } from '../actions'
import {
  SEARCH_PARAMS,
  SearchParamUpdates,
  isBackgroundAgentRunStatus,
} from '../types'
import { BackgroundAgentRunList } from './BackgroundAgentRunList'
import { BackgroundAgentRunsFilterForm } from './BackgroundAgentRunsFilterForm'

const parsePageParam = (value: string | null): number => {
  if (!value) return 1
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed >= 1 ? parsed : 1
}

const parsePerPageParam = (value: string | null): PerPageOption => {
  if (!value) return DEFAULT_PER_PAGE
  const parsed = Number(value)
  return isPerPageOption(parsed) ? parsed : DEFAULT_PER_PAGE
}

export const BackgroundAgentRunsPage = () => {
  const searchParams = useSearchParams()
  const router = useRouter()

  const currentPage = parsePageParam(searchParams.get(SEARCH_PARAMS.PAGE))
  const perPage = parsePerPageParam(searchParams.get(SEARCH_PARAMS.PER_PAGE))

  const agentName = searchParams.get(SEARCH_PARAMS.AGENT_NAME) ?? undefined
  const statusParam = searchParams.get(SEARCH_PARAMS.STATUS)
  const status =
    statusParam && isBackgroundAgentRunStatus(statusParam)
      ? statusParam
      : undefined
  const organization = searchParams.get(SEARCH_PARAMS.ORGANIZATION) ?? undefined
  const createdAfter =
    searchParams.get(SEARCH_PARAMS.CREATED_AFTER) ?? undefined
  const createdBefore =
    searchParams.get(SEARCH_PARAMS.CREATED_BEFORE) ?? undefined

  const [isLoading, setIsLoading] = useState(false)
  const [runs, setRuns] = useState<BackgroundAgentRunListItem[] | null>(null)
  const [meta, setMeta] = useState<PaginationMeta | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    const fetchRuns = async () => {
      setIsLoading(true)
      setError(null)

      try {
        const result = await searchBackgroundAgentRuns({
          [SEARCH_PARAMS.AGENT_NAME]: agentName,
          [SEARCH_PARAMS.STATUS]: status,
          [SEARCH_PARAMS.ORGANIZATION]: organization,
          [SEARCH_PARAMS.CREATED_AFTER]: createdAfter,
          [SEARCH_PARAMS.CREATED_BEFORE]: createdBefore,
          [SEARCH_PARAMS.PAGE]: currentPage,
          [SEARCH_PARAMS.PER_PAGE]: perPage,
        })

        if (cancelled) return

        setRuns(result.data)
        setMeta(result.meta)
      } catch (err) {
        if (cancelled) return
        setError('Failed to load agent runs. Please try again.')
        console.error('Agent run load error:', err)
      } finally {
        if (!cancelled) setIsLoading(false)
      }
    }

    fetchRuns()

    return () => {
      cancelled = true
    }
  }, [
    agentName,
    status,
    organization,
    createdAfter,
    createdBefore,
    currentPage,
    perPage,
  ])

  const updateSearchParams = useCallback(
    (updates: SearchParamUpdates) => {
      const params = new URLSearchParams(searchParams.toString())
      for (const [key, value] of Object.entries(updates)) {
        if (value === undefined) {
          params.delete(key)
        } else {
          params.set(key, value)
        }
      }
      const queryString = params.toString()
      router.push(
        `/dashboard/background-agent-runs${queryString ? `?${queryString}` : ''}`
      )
    },
    [searchParams, router]
  )

  const handleApplyFilters = (updates: SearchParamUpdates) => {
    updateSearchParams({ ...updates, [SEARCH_PARAMS.PAGE]: undefined })
  }

  const handlePageChange = (page: number) => {
    updateSearchParams({
      [SEARCH_PARAMS.PAGE]: page === 1 ? undefined : String(page),
    })
  }

  const handlePerPageChange = (newPerPage: PerPageOption) => {
    updateSearchParams({
      [SEARCH_PARAMS.PER_PAGE]:
        newPerPage === DEFAULT_PER_PAGE ? undefined : String(newPerPage),
      [SEARCH_PARAMS.PAGE]: undefined,
    })
  }

  return (
    <Container size="4">
      <Heading size="6" mb="4">
        Agent Run
      </Heading>

      <Box mb="6">
        <BackgroundAgentRunsFilterForm
          agentName={agentName}
          status={status}
          organization={organization}
          createdAfter={createdAfter}
          createdBefore={createdBefore}
          onApply={handleApplyFilters}
        />
      </Box>

      {isLoading && <LoadingSpinner>Loading...</LoadingSpinner>}

      {error && (
        <Text color="red" size="3">
          {error}
        </Text>
      )}

      {!isLoading && !error && runs !== null && (
        <>
          <BackgroundAgentRunList runs={runs} />
          {meta && (
            <Pagination
              meta={meta}
              currentPage={currentPage}
              perPage={perPage}
              onPageChange={handlePageChange}
              onPerPageChange={handlePerPageChange}
            />
          )}
        </>
      )}
    </Container>
  )
}
