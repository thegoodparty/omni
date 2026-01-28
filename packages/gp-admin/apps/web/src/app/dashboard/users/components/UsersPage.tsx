'use client'

import { useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { Container, Heading, Box, Text } from '@radix-ui/themes'
import { UserSearchForm } from '@/components/UserSearchForm'
import { LoadingSpinner } from '@/components/LoadingSpinner'
import { searchUsers } from '../actions'
import { User, SEARCH_PARAMS } from '../types'
import { UserList } from './UserList'

export default function UsersPage() {
  const searchParams = useSearchParams()

  const [isLoading, setIsLoading] = useState(false)
  const [users, setUsers] = useState<User[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  const hasSearchParams =
    searchParams.has(SEARCH_PARAMS.EMAIL) ||
    searchParams.has(SEARCH_PARAMS.FIRST_NAME) ||
    searchParams.has(SEARCH_PARAMS.LAST_NAME)

  useEffect(() => {
    if (!hasSearchParams) {
      setUsers(null)
      setError(null)
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
        })

        setUsers(result || [])
      } catch (err) {
        setError('Failed to search users. Please try again.')
        console.error('Search error:', err)
      } finally {
        setIsLoading(false)
      }
    }

    fetchUsers()
  }, [searchParams, hasSearchParams])

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

      {!isLoading && !error && users !== null && <UserList users={users} />}
    </Container>
  )
}
