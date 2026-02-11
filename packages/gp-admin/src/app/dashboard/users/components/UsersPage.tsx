'use client'

import { useEffect, useState, useCallback } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import { Container, Heading, Box, Text } from '@radix-ui/themes'
import { UserSearchForm } from '@/components/UserSearchForm'
import { LoadingSpinner } from '@/components/LoadingSpinner'
import { searchUsers } from '../actions'
import {
  User,
  PaginationMeta,
  SEARCH_PARAMS,
  DEFAULT_PER_PAGE,
  PerPageOption,
  isPerPageOption,
} from '../types'
import { UserList } from './UserList'
import { Pagination } from './Pagination'

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

  const hasSearchParams =
    searchParams.has(SEARCH_PARAMS.EMAIL) ||
    searchParams.has(SEARCH_PARAMS.FIRST_NAME) ||
    searchParams.has(SEARCH_PARAMS.LAST_NAME)

  const [isLoading, setIsLoading] = useState(false)
  const [users, setUsers] = useState<User[] | null>(null)
  const [meta, setMeta] = useState<PaginationMeta | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!hasSearchParams) {
      setUsers(null)
      setMeta(null)
      return
    }

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
        })

        setUsers(result.data)
        setMeta(result.meta)
      } catch (err) {
        setError('Failed to search users. Please try again.')
        console.error('Search error:', err)
      } finally {
        setIsLoading(false)
      }
    }

    fetchUsers()
  }, [searchParams])

  const updateSearchParams = useCallback(
    (updates: Record<string, string | undefined>) => {
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

      {!hasSearchParams && (
        <Text color="gray" size="3">
          Use the search form above to find users by email or name.
        </Text>
      )}

      {hasSearchParams && isLoading && (
        <LoadingSpinner>Searching...</LoadingSpinner>
      )}

      {hasSearchParams && error && (
        <Text color="red" size="3">
          {error}
        </Text>
      )}

      {hasSearchParams && !isLoading && !error && users !== null && (
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
