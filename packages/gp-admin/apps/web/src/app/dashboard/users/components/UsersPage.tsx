'use client'

import { useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Container, Heading, Box, Text } from '@radix-ui/themes'
import { UserSearchForm } from '@/components/UserSearchForm'
import { LoadingSpinner } from '@/components/LoadingSpinner'
import { searchUsers } from '../actions'
import { User } from '../types'
import { UserList } from './UserList'

export default function UsersPage() {
  const router = useRouter()
  const searchParams = useSearchParams()

  const [isLoading, setIsLoading] = useState(false)
  const [users, setUsers] = useState<User[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  const hasSearchParams =
    searchParams.has('email') ||
    searchParams.has('first_name') ||
    searchParams.has('last_name')

  useEffect(() => {
    if (!hasSearchParams) {
      setUsers(null)
      setError(null)
      return
    }

    let isCancelled = false

    const fetchUsers = async () => {
      setIsLoading(true)
      setError(null)

      try {
        const result = await searchUsers({
          email: searchParams.get('email') ?? undefined,
          first_name: searchParams.get('first_name') ?? undefined,
          last_name: searchParams.get('last_name') ?? undefined,
        })

        if (isCancelled) return

        if (result === null) {
          setUsers([])
        } else if (Array.isArray(result)) {
          setUsers(result)
        } else {
          // Single user result - redirect to user page
          router.push(`/dashboard/users/${result.id}`)
          return
        }
      } catch (err) {
        if (isCancelled) return
        setError('Failed to search users. Please try again.')
        console.error('Search error:', err)
      } finally {
        if (!isCancelled) {
          setIsLoading(false)
        }
      }
    }

    fetchUsers()

    return () => {
      isCancelled = true
    }
  }, [searchParams, hasSearchParams, router])

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
