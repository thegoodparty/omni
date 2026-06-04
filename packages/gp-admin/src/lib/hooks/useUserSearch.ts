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

export type ProFilter = 'all' | 'pro' | 'not_pro'

const PRO_FILTER_TO_PARAM: Record<ProFilter, string | undefined> = {
  all: undefined,
  pro: 'true',
  not_pro: 'false',
}

type NavState = {
  email: string
  firstName: string
  lastName: string
  proFilter: ProFilter
}

const buildUsersUrl = ({ email, firstName, lastName, proFilter }: NavState) => {
  const entries: ReadonlyArray<readonly [string, string | undefined]> = [
    [SEARCH_PARAMS.EMAIL, email.trim() || undefined],
    [SEARCH_PARAMS.FIRST_NAME, firstName.trim() || undefined],
    [SEARCH_PARAMS.LAST_NAME, lastName.trim() || undefined],
    [SEARCH_PARAMS.IS_PRO, PRO_FILTER_TO_PARAM[proFilter]],
  ]
  const params = new URLSearchParams()
  for (const [k, v] of entries) if (v !== undefined) params.set(k, v)
  const qs = params.toString()
  return `${USERS_PATH}${qs ? `?${qs}` : ''}`
}

const proFilterFromParam = (value: string | null): ProFilter =>
  value === 'true' ? 'pro' : value === 'false' ? 'not_pro' : 'all'

interface FormData {
  email: string
  firstName: string
  lastName: string
}

export const useUserSearch = () => {
  const router = useRouter()
  const searchParams = useSearchParams()

  const initialTab: Tab =
    searchParams.get(SEARCH_PARAMS.FIRST_NAME) ||
    searchParams.get(SEARCH_PARAMS.LAST_NAME)
      ? SEARCH_TAB.NAME
      : SEARCH_TAB.EMAIL

  const [activeTab, setActiveTab] = useState<Tab>(initialTab)
  const [proFilter, setProFilter] = useState<ProFilter>(() =>
    proFilterFromParam(searchParams.get(SEARCH_PARAMS.IS_PRO))
  )

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

    setProFilter(proFilterFromParam(searchParams.get(SEARCH_PARAMS.IS_PRO)))

    if (firstNameParam || lastNameParam) {
      setActiveTab(SEARCH_TAB.NAME)
    } else if (emailParam) {
      setActiveTab(SEARCH_TAB.EMAIL)
    }
  }, [searchParams, reset])

  const emailValue = watchedValues.email
  const firstNameValue = watchedValues.firstName
  const lastNameValue = watchedValues.lastName

  const debouncedNavigate = useDebouncedCallback((state: NavState) => {
    skipNextSync.current = true
    router.replace(buildUsersUrl(state))
  }, 300)

  const isInitialMount = useRef(true)
  useEffect(() => {
    if (isInitialMount.current) {
      isInitialMount.current = false
      return
    }
    debouncedNavigate({
      email: emailValue,
      firstName: firstNameValue,
      lastName: lastNameValue,
      proFilter,
    })
  }, [emailValue, firstNameValue, lastNameValue, proFilter, debouncedNavigate])

  const handleTabChange = (tab: string) => {
    setActiveTab(tab as Tab)
    if (tab === SEARCH_TAB.EMAIL) {
      setValue('firstName', '', { shouldValidate: true })
      setValue('lastName', '', { shouldValidate: true })
    } else {
      setValue('email', '', { shouldValidate: true })
    }
  }

  const onSubmit = (data: FormData) =>
    router.push(buildUsersUrl({ ...data, proFilter }))

  const handleClear = () => {
    reset({ email: '', firstName: '', lastName: '' })
    setProFilter('all')
    router.push(USERS_PATH)
  }

  const showClear = !!(
    emailValue ||
    firstNameValue ||
    lastNameValue ||
    proFilter !== 'all'
  )

  return {
    activeTab,
    handleTabChange,
    register,
    handleSubmit,
    onSubmit,
    handleClear,
    showClear,
    proFilter,
    setProFilter,
  }
}
