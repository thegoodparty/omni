'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import { useState, useEffect, useRef } from 'react'
import { useDebounce } from '@/lib/hooks/useDebounce'
import { useForm } from 'react-hook-form'
import {
  TextField,
  Button,
  Flex,
  Box,
  Text,
  SegmentedControl,
} from '@radix-ui/themes'
import { HiSearch, HiX } from 'react-icons/hi'
import { SEARCH_PARAMS } from '@/app/dashboard/users/types'
import { FORM_MODE } from '@/shared/constants/form'

const USERS_PATH = '/dashboard/users'

const SEARCH_TAB = {
  EMAIL: 'email',
  NAME: 'name',
} as const

type Tab = (typeof SEARCH_TAB)[keyof typeof SEARCH_TAB]

interface FormData {
  email: string
  firstName: string
  lastName: string
}

export function UserSearchForm() {
  const router = useRouter()
  const searchParams = useSearchParams()

  const initialTab: Tab =
    searchParams.get(SEARCH_PARAMS.FIRST_NAME) ||
    searchParams.get(SEARCH_PARAMS.LAST_NAME)
      ? SEARCH_TAB.NAME
      : SEARCH_TAB.EMAIL

  const [activeTab, setActiveTab] = useState<Tab>(initialTab)

  const { register, handleSubmit, watch, reset, setValue } = useForm<FormData>({
    mode: FORM_MODE.ON_CHANGE,
    defaultValues: {
      email: searchParams.get(SEARCH_PARAMS.EMAIL) ?? '',
      firstName: searchParams.get(SEARCH_PARAMS.FIRST_NAME) ?? '',
      lastName: searchParams.get(SEARCH_PARAMS.LAST_NAME) ?? '',
    },
  })

  const watchedValues = watch()

  // Sync form with URL params when they change externally
  const skipNextSync = useRef(false)
  useEffect(() => {
    if (skipNextSync.current) {
      skipNextSync.current = false
      return
    }

    const emailParam = searchParams.get(SEARCH_PARAMS.EMAIL)
    const firstNameParam = searchParams.get(SEARCH_PARAMS.FIRST_NAME)
    const lastNameParam = searchParams.get(SEARCH_PARAMS.LAST_NAME)

    reset({
      email: emailParam ?? '',
      firstName: firstNameParam ?? '',
      lastName: lastNameParam ?? '',
    })

    if (firstNameParam || lastNameParam) {
      setActiveTab(SEARCH_TAB.NAME)
    } else if (emailParam) {
      setActiveTab(SEARCH_TAB.EMAIL)
    }
  }, [searchParams, reset])

  const emailValue = watchedValues.email
  const firstNameValue = watchedValues.firstName
  const lastNameValue = watchedValues.lastName

  const debouncedEmail = useDebounce(emailValue, 300)
  const debouncedFirstName = useDebounce(firstNameValue, 300)
  const debouncedLastName = useDebounce(lastNameValue, 300)

  const isInitialEmailMount = useRef(true)
  useEffect(() => {
    if (activeTab !== SEARCH_TAB.EMAIL) return
    if (isInitialEmailMount.current) {
      isInitialEmailMount.current = false
      return
    }

    const trimmed = debouncedEmail.trim()
    skipNextSync.current = true
    if (trimmed) {
      router.replace(
        `${USERS_PATH}?${SEARCH_PARAMS.EMAIL}=${encodeURIComponent(trimmed)}`
      )
    } else {
      router.replace(USERS_PATH)
    }
  }, [debouncedEmail, activeTab, router])

  const isInitialNameMount = useRef(true)
  useEffect(() => {
    if (activeTab !== SEARCH_TAB.NAME) return
    if (isInitialNameMount.current) {
      isInitialNameMount.current = false
      return
    }

    const params = new URLSearchParams()
    if (debouncedFirstName.trim())
      params.set(SEARCH_PARAMS.FIRST_NAME, debouncedFirstName.trim())
    if (debouncedLastName.trim())
      params.set(SEARCH_PARAMS.LAST_NAME, debouncedLastName.trim())
    skipNextSync.current = true
    const qs = params.toString()
    router.replace(`${USERS_PATH}${qs ? `?${qs}` : ''}`)
  }, [debouncedFirstName, debouncedLastName, activeTab, router])

  const handleTabChange = (tab: string) => {
    setActiveTab(tab as Tab)
    if (tab === SEARCH_TAB.EMAIL) {
      setValue('firstName', '', { shouldValidate: true })
      setValue('lastName', '', { shouldValidate: true })
    } else {
      setValue('email', '', { shouldValidate: true })
    }
  }

  const onSubmit = (data: FormData) => {
    const params = new URLSearchParams()

    if (data.email.trim()) {
      params.set(SEARCH_PARAMS.EMAIL, data.email.trim())
    }
    if (data.firstName.trim()) {
      params.set(SEARCH_PARAMS.FIRST_NAME, data.firstName.trim())
    }
    if (data.lastName.trim()) {
      params.set(SEARCH_PARAMS.LAST_NAME, data.lastName.trim())
    }

    const queryString = params.toString()
    router.push(`${USERS_PATH}${queryString ? `?${queryString}` : ''}`)
  }

  const handleClear = () => {
    reset({ email: '', firstName: '', lastName: '' })
    router.push(USERS_PATH)
  }

  const showClear =
    watchedValues.email || watchedValues.firstName || watchedValues.lastName

  return (
    <Box asChild p="4" className="border border-[var(--gray-5)] rounded-lg">
      <form onSubmit={handleSubmit(onSubmit)}>
        <Flex direction="column" gap="4">
          <Box>
            <Text as="label" size="2" weight="medium" mb="2" mr="2">
              Search by
            </Text>
            <SegmentedControl.Root
              value={activeTab}
              onValueChange={handleTabChange}
            >
              <SegmentedControl.Item value={SEARCH_TAB.EMAIL}>
                Email
              </SegmentedControl.Item>
              <SegmentedControl.Item value={SEARCH_TAB.NAME}>
                Name
              </SegmentedControl.Item>
            </SegmentedControl.Root>
          </Box>

          {activeTab === SEARCH_TAB.EMAIL ? (
            <Box style={{ maxWidth: '400px' }}>
              <Text as="label" size="2" weight="medium" mb="1">
                Email
              </Text>
              <TextField.Root
                placeholder="Enter email address..."
                {...register('email')}
              >
                <TextField.Slot>
                  <HiSearch className="w-4 h-4" />
                </TextField.Slot>
              </TextField.Root>
            </Box>
          ) : (
            <Flex gap="4" wrap="wrap">
              <Box flexGrow="1" style={{ minWidth: '180px' }}>
                <Text as="label" size="2" weight="medium" mb="1">
                  First Name
                </Text>
                <TextField.Root
                  placeholder="Enter first name..."
                  {...register('firstName')}
                >
                  <TextField.Slot>
                    <HiSearch className="w-4 h-4" />
                  </TextField.Slot>
                </TextField.Root>
              </Box>

              <Box flexGrow="1" style={{ minWidth: '180px' }}>
                <Text as="label" size="2" weight="medium" mb="1">
                  Last Name
                </Text>
                <TextField.Root
                  placeholder="Enter last name..."
                  {...register('lastName')}
                >
                  <TextField.Slot>
                    <HiSearch className="w-4 h-4" />
                  </TextField.Slot>
                </TextField.Root>
              </Box>
            </Flex>
          )}

          <Flex gap="2" justify="end">
            {showClear && (
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
          </Flex>
        </Flex>
      </form>
    </Box>
  )
}
