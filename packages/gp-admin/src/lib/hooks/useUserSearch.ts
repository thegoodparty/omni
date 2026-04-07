'use client'

import { useState, useEffect, useRef } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useForm } from 'react-hook-form'
import { useDebouncedCallback } from './useDebouncedCallback'
import { SEARCH_PARAMS } from '@/app/dashboard/users/types'
import { FORM_MODE } from '@/shared/constants/form'

const USERS_PATH = '/dashboard/users'

export const SEARCH_TAB = {
  EMAIL: 'email',
  NAME: 'name',
} as const

export type Tab = (typeof SEARCH_TAB)[keyof typeof SEARCH_TAB]

interface FormData {
  email: string
  firstName: string
  lastName: string
}

export function useUserSearch() {
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

  const debouncedNavigate = useDebouncedCallback(
    (tab: Tab, email: string, firstName: string, lastName: string) => {
      skipNextSync.current = true
      if (tab === SEARCH_TAB.EMAIL) {
        const trimmed = email.trim()
        if (trimmed) {
          router.replace(
            `${USERS_PATH}?${SEARCH_PARAMS.EMAIL}=${encodeURIComponent(trimmed)}`
          )
        } else {
          router.replace(USERS_PATH)
        }
      } else {
        const params = new URLSearchParams()
        if (firstName.trim())
          params.set(SEARCH_PARAMS.FIRST_NAME, firstName.trim())
        if (lastName.trim())
          params.set(SEARCH_PARAMS.LAST_NAME, lastName.trim())
        const qs = params.toString()
        router.replace(`${USERS_PATH}${qs ? `?${qs}` : ''}`)
      }
    },
    300
  )

  const isInitialMount = useRef(true)
  useEffect(() => {
    if (isInitialMount.current) {
      isInitialMount.current = false
      return
    }
    debouncedNavigate(activeTab, emailValue, firstNameValue, lastNameValue)
  }, [activeTab, emailValue, firstNameValue, lastNameValue, debouncedNavigate])

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
    if (data.email.trim()) params.set(SEARCH_PARAMS.EMAIL, data.email.trim())
    if (data.firstName.trim())
      params.set(SEARCH_PARAMS.FIRST_NAME, data.firstName.trim())
    if (data.lastName.trim())
      params.set(SEARCH_PARAMS.LAST_NAME, data.lastName.trim())
    const qs = params.toString()
    router.push(`${USERS_PATH}${qs ? `?${qs}` : ''}`)
  }

  const handleClear = () => {
    reset({ email: '', firstName: '', lastName: '' })
    router.push(USERS_PATH)
  }

  const showClear = !!(emailValue || firstNameValue || lastNameValue)

  return {
    activeTab,
    handleTabChange,
    register,
    handleSubmit,
    onSubmit,
    handleClear,
    showClear,
  }
}
