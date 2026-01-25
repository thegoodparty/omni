'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import { FormEvent, useState, useEffect, useMemo } from 'react'
import {
  TextField,
  Button,
  Flex,
  Box,
  Text,
  SegmentedControl,
} from '@radix-ui/themes'
import { HiSearch, HiX } from 'react-icons/hi'
import { z } from 'zod'

type SearchMode = 'email' | 'name'

const emailSchema = z.string().email('Please enter a valid email address')
const nameSchema = z.string().min(3, 'Must be at least 3 characters')

const USERS_PATH = '/dashboard/users'

export function UserSearchForm() {
  const router = useRouter()
  const searchParams = useSearchParams()

  // Determine initial search mode from URL params
  const getInitialSearchMode = (): SearchMode => {
    if (searchParams.get('email')) return 'email'
    if (searchParams.get('first_name') || searchParams.get('last_name'))
      return 'name'
    return 'email'
  }

  const [searchMode, setSearchMode] = useState<SearchMode>(getInitialSearchMode)
  const [email, setEmail] = useState(searchParams.get('email') ?? '')
  const [firstName, setFirstName] = useState(
    searchParams.get('first_name') ?? ''
  )
  const [lastName, setLastName] = useState(searchParams.get('last_name') ?? '')

  const [emailError, setEmailError] = useState<string | null>(null)
  const [firstNameError, setFirstNameError] = useState<string | null>(null)
  const [lastNameError, setLastNameError] = useState<string | null>(null)

  // Sync state with URL params when they change externally
  useEffect(() => {
    const emailParam = searchParams.get('email')
    const firstNameParam = searchParams.get('first_name')
    const lastNameParam = searchParams.get('last_name')

    setEmail(emailParam ?? '')
    setFirstName(firstNameParam ?? '')
    setLastName(lastNameParam ?? '')

    // Determine search mode from current params
    if (emailParam) {
      setSearchMode('email')
    } else if (firstNameParam || lastNameParam) {
      setSearchMode('name')
    } else {
      setSearchMode('email')
    }

    setEmailError(null)
    setFirstNameError(null)
    setLastNameError(null)
  }, [searchParams])

  const clearErrors = () => {
    setEmailError(null)
    setFirstNameError(null)
    setLastNameError(null)
  }

  const validateEmail = (value: string): boolean => {
    if (!value.trim()) {
      setEmailError(null)
      return false
    }
    const result = emailSchema.safeParse(value.trim())
    if (!result.success) {
      setEmailError(result.error.issues[0].message)
      return false
    }
    setEmailError(null)
    return true
  }

  const validateName = (
    value: string,
    setError: (error: string | null) => void
  ): boolean => {
    if (!value.trim()) {
      setError(null)
      return false
    }
    const result = nameSchema.safeParse(value.trim())
    if (!result.success) {
      setError(result.error.issues[0].message)
      return false
    }
    setError(null)
    return true
  }

  const handleEmailChange = (value: string) => {
    setEmail(value)
    validateEmail(value)
  }

  const handleFirstNameChange = (value: string) => {
    setFirstName(value)
    validateName(value, setFirstNameError)
  }

  const handleLastNameChange = (value: string) => {
    setLastName(value)
    validateName(value, setLastNameError)
  }

  const handleSearchModeChange = (value: string) => {
    setSearchMode(value as SearchMode)
    clearErrors()
  }

  // Check if form is valid based on current search mode
  const isFormValid = useMemo(() => {
    if (searchMode === 'email') {
      const trimmed = email.trim()
      return trimmed && emailSchema.safeParse(trimmed).success
    } else {
      const trimmedFirst = firstName.trim()
      const trimmedLast = lastName.trim()
      const isFirstValid =
        trimmedFirst && nameSchema.safeParse(trimmedFirst).success
      const isLastValid =
        trimmedLast && nameSchema.safeParse(trimmedLast).success
      return isFirstValid && isLastValid
    }
  }, [searchMode, email, firstName, lastName])

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault()

    if (!isFormValid) return

    const params = new URLSearchParams()

    if (searchMode === 'email') {
      params.set('email', email.trim())
    } else {
      params.set('first_name', firstName.trim())
      params.set('last_name', lastName.trim())
    }

    const queryString = params.toString()
    router.push(`${USERS_PATH}${queryString ? `?${queryString}` : ''}`)
  }

  const handleClear = () => {
    setEmail('')
    setFirstName('')
    setLastName('')
    clearErrors()
    router.push(USERS_PATH)
  }

  // Show Clear button if there are URL params (active search) OR current form fields have values
  const hasUrlParams =
    searchParams.get('email') ||
    searchParams.get('first_name') ||
    searchParams.get('last_name')
  const hasFormValues = email || firstName || lastName
  const hasFilters = hasUrlParams || hasFormValues

  return (
    <Box asChild p="4" className="border border-[var(--gray-5)] rounded-lg">
      <form onSubmit={handleSubmit}>
        <Flex direction="column" gap="4">
          <Box>
            <Text as="label" size="2" weight="medium" mb="2" mr="2">
              Search by
            </Text>
            <SegmentedControl.Root
              value={searchMode}
              onValueChange={handleSearchModeChange}
            >
              <SegmentedControl.Item value="email">Email</SegmentedControl.Item>
              <SegmentedControl.Item value="name">Name</SegmentedControl.Item>
            </SegmentedControl.Root>
          </Box>

          {searchMode === 'email' ? (
            <Box style={{ maxWidth: '400px' }}>
              <Text as="label" size="2" weight="medium" mb="1">
                Email
              </Text>
              <TextField.Root
                placeholder="Enter email address..."
                value={email}
                onChange={(e) => handleEmailChange(e.target.value)}
                color={emailError ? 'red' : undefined}
              >
                <TextField.Slot>
                  <HiSearch className="w-4 h-4" />
                </TextField.Slot>
              </TextField.Root>
              {emailError && (
                <Text size="1" color="red" mt="1">
                  {emailError}
                </Text>
              )}
            </Box>
          ) : (
            <Flex gap="4" wrap="wrap">
              <Box flexGrow="1" style={{ minWidth: '180px' }}>
                <Text as="label" size="2" weight="medium" mb="1">
                  First Name
                </Text>
                <TextField.Root
                  placeholder="Enter first name..."
                  value={firstName}
                  onChange={(e) => handleFirstNameChange(e.target.value)}
                  color={firstNameError ? 'red' : undefined}
                >
                  <TextField.Slot>
                    <HiSearch className="w-4 h-4" />
                  </TextField.Slot>
                </TextField.Root>
                {firstNameError && (
                  <Text size="1" color="red" mt="1">
                    {firstNameError}
                  </Text>
                )}
              </Box>

              <Box flexGrow="1" style={{ minWidth: '180px' }}>
                <Text as="label" size="2" weight="medium" mb="1">
                  Last Name
                </Text>
                <TextField.Root
                  placeholder="Enter last name..."
                  value={lastName}
                  onChange={(e) => handleLastNameChange(e.target.value)}
                  color={lastNameError ? 'red' : undefined}
                >
                  <TextField.Slot>
                    <HiSearch className="w-4 h-4" />
                  </TextField.Slot>
                </TextField.Root>
                {lastNameError && (
                  <Text size="1" color="red" mt="1">
                    {lastNameError}
                  </Text>
                )}
              </Box>
            </Flex>
          )}

          <Flex gap="2" justify="end">
            {hasFilters && (
              <Button
                type="button"
                variant="soft"
                color="gray"
                onClick={handleClear}
              >
                <HiX className="w-4 h-4" />
                Clear
              </Button>
            )}
            <Button type="submit" disabled={!isFormValid}>
              <HiSearch className="w-4 h-4" />
              Search
            </Button>
          </Flex>
        </Flex>
      </form>
    </Box>
  )
}
