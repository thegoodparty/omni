'use client'

import { useEffect, useState, useCallback } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import { Container, Heading, Box, Text } from '@radix-ui/themes'
import type { PaginationMeta } from '@goodparty_org/sdk'
import { UserSearchForm } from '@/components/UserSearchForm'
import { LoadingSpinner } from '@/components/LoadingSpinner'
import { searchUsers, getUsersProFlags } from '../actions'
import {
  User,
  SEARCH_PARAMS,
  DEFAULT_PER_PAGE,
  PerPageOption,
  isPerPageOption,
  SearchParamUpdates,
} from '../types'
import { UserList } from './UserList'
import { Pagination } from '@/components/Pagination'

function parsePageParam(value: string | null): number {
  if (!value) return 1
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed >= 1 ? parsed : 1
}

function parsePerPageParam(value: string | null): PerPageOption {
  if (!value) return DEFAULT_PER_PAGE
  const parsed = Number(value)
  return isPerPageOption(parsed) ? parsed : DEFAULT_PER_PAGE
}

export default function UsersPage() {
  const searchParams = useSearchParams()
  const router = useRouter()

  const currentPage = parsePageParam(searchParams.get(SEARCH_PARAMS.PAGE))
  const perPage = parsePerPageParam(searchParams.get(SEARCH_PARAMS.PER_PAGE))
  const isProParam = searchParams.get(SEARCH_PARAMS.IS_PRO)
  const isPro =
    isProParam === 'true' ? true : isProParam === 'false' ? false : undefined

  const [isLoading, setIsLoading] = useState(false)
  const [users, setUsers] = useState<User[] | null>(null)
  const [meta, setMeta] = useState<PaginationMeta | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    const fetchUsers = async () => {
      setIsLoading(true)
      setError(null)

      try {
        const result = await searchUsers({
          [SEARCH_PARAMS.EMAIL]:
            searchParams.get(SEARCH_PARAMS.EMAIL) ?? undefined,
          [SEARCH_PARAMS.FIRST_NAME]:
            searchParams.get(SEARCH_PARAMS.FIRST_NAME) ?? undefined,
          [SEARCH_PARAMS.LAST_NAME]:
            searchParams.get(SEARCH_PARAMS.LAST_NAME) ?? undefined,
          [SEARCH_PARAMS.PAGE]: currentPage,
          [SEARCH_PARAMS.PER_PAGE]: perPage,
          [SEARCH_PARAMS.IS_PRO]: isPro,
        })

        if (cancelled) return

        setUsers(result.data)
        setMeta(result.meta)
        setIsLoading(false)

        const ids = result.data.map((u) => u.id)
        if (ids.length === 0) return

        try {
          const flags = await getUsersProFlags(ids)
          if (cancelled) return
          setUsers((prev) =>
            prev
              ? prev.map((u) => ({ ...u, isPro: flags[u.id] ?? false }))
              : prev
          )
        } catch (flagsErr) {
          console.error('Failed to load Pro flags:', flagsErr)
        }
      } catch (err) {
        if (cancelled) return
        setError('Failed to search users. Please try again.')
        console.error('Search error:', err)
        setIsLoading(false)
      }
    }

    fetchUsers()

    return () => {
      cancelled = true
    }
  }, [searchParams, currentPage, perPage, isPro])

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
      router.push(`/dashboard/users${queryString ? `?${queryString}` : ''}`)
    },
    [searchParams, router]
  )

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
        Search Users
      </Heading>

      <Box mb="6">
        <UserSearchForm />
      </Box>

      {isLoading && <LoadingSpinner>Searching...</LoadingSpinner>}

      {error && (
        <Text color="red" size="3">
          {error}
        </Text>
      )}

      {!isLoading && !error && users !== null && (
        <>
          <UserList users={users} />
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
