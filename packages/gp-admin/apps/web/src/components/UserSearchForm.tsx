'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import { useState, useEffect } from 'react'
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
import { z } from 'zod'
import { SEARCH_PARAMS } from '@/app/dashboard/users/types'

const emailSchema = z.email()

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

  const {
    register,
    handleSubmit,
    watch,
    reset,
    setValue,
    formState: { errors },
  } = useForm<FormData>({
    mode: 'onChange',
    defaultValues: {
      email: searchParams.get(SEARCH_PARAMS.EMAIL) ?? '',
      firstName: searchParams.get(SEARCH_PARAMS.FIRST_NAME) ?? '',
      lastName: searchParams.get(SEARCH_PARAMS.LAST_NAME) ?? '',
    },
  })

  const watchedValues = watch()

  // Sync form with URL params when they change externally
  useEffect(() => {
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

  const hasUrlParams =
    searchParams.get(SEARCH_PARAMS.EMAIL) ||
    searchParams.get(SEARCH_PARAMS.FIRST_NAME) ||
    searchParams.get(SEARCH_PARAMS.LAST_NAME)
  const hasFormValues =
    watchedValues.email || watchedValues.firstName || watchedValues.lastName
  const showClear = hasUrlParams || hasFormValues

  // Validation rules based on active tab
  const emailValidation =
    activeTab === SEARCH_TAB.EMAIL
      ? {
          required: 'Email is required',
          validate: (value: string) =>
            emailSchema.safeParse(value).success ||
            'Please enter a valid email address',
        }
      : {}

  const nameValidation =
    activeTab === SEARCH_TAB.NAME
      ? {
          required: 'This field is required',
          minLength: { value: 2, message: 'Must be at least 2 characters' },
        }
      : {}

  const canSubmit =
    activeTab === SEARCH_TAB.EMAIL
      ? watchedValues.email.trim() && !errors.email
      : watchedValues.firstName.trim() &&
        watchedValues.lastName.trim() &&
        !errors.firstName &&
        !errors.lastName

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
                {...register('email', emailValidation)}
                color={errors.email ? 'red' : undefined}
              >
                <TextField.Slot>
                  <HiSearch className="w-4 h-4" />
                </TextField.Slot>
              </TextField.Root>
              {errors.email && (
                <Text size="1" color="red" mt="1">
                  {errors.email.message}
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
                  {...register('firstName', nameValidation)}
                  color={errors.firstName ? 'red' : undefined}
                >
                  <TextField.Slot>
                    <HiSearch className="w-4 h-4" />
                  </TextField.Slot>
                </TextField.Root>
                {errors.firstName && (
                  <Text size="1" color="red" mt="1">
                    {errors.firstName.message}
                  </Text>
                )}
              </Box>

              <Box flexGrow="1" style={{ minWidth: '180px' }}>
                <Text as="label" size="2" weight="medium" mb="1">
                  Last Name
                </Text>
                <TextField.Root
                  placeholder="Enter last name..."
                  {...register('lastName', nameValidation)}
                  color={errors.lastName ? 'red' : undefined}
                >
                  <TextField.Slot>
                    <HiSearch className="w-4 h-4" />
                  </TextField.Slot>
                </TextField.Root>
                {errors.lastName && (
                  <Text size="1" color="red" mt="1">
                    {errors.lastName.message}
                  </Text>
                )}
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
            <Button type="submit" disabled={!canSubmit}>
              <HiSearch className="w-4 h-4" />
              Search
            </Button>
          </Flex>
        </Flex>
      </form>
    </Box>
  )
}
