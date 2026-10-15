'use client'
import { useState, useCallback, useMemo, useEffect } from 'react'
import { useUser } from '@shared/hooks/useUser'
import {
  personElectQuestion,
  sworninQuestion,
} from '../onboarding/components/DemoMessageText'
import { composePollMessage } from 'app/dashboard/outreach/v2/poll/pollCompose.util'
import { format, isBefore } from 'date-fns'
import { EVENTS, trackEvent } from 'helpers/analyticsHelper'
import {
  mergeTagToken,
  type ServePollCreateResponse,
} from '@goodparty_org/contracts'
import { grammarizeOfficeName } from '../onboarding/utils/grammarizeOfficeName'
import { clientRequest } from 'gpApi/typed-request'
import { usePositionName } from '@shared/hooks/usePositionName'

interface FormData {
  imageUrl: string | null
  scheduledDate: Date | null
  swornInDate: Date | null
  swornIn: boolean
}

interface StepValidation {
  'Sworn In': boolean
  'Pick Send Date': boolean
}

export interface UseOnboardingReturn {
  formData: FormData
  isSubmitting: boolean
  submitError: string | null
  setImageUrl: (imageUrl: string | null) => void
  setSwornInDate: (swornInDate: Date | undefined) => void
  setScheduledDate: (scheduledDate: Date | undefined) => void
  submitOnboarding: () => Promise<ServePollCreateResponse>
  resetFormData: () => void
  demoMessageText: string
  user: ReturnType<typeof useUser>[0]
  stepValidation: StepValidation
}

export const useOnboarding = (): UseOnboardingReturn => {
  const positionName = usePositionName()
  const [user] = useUser()

  const [formData, setFormData] = useState<FormData>({
    imageUrl: null,
    scheduledDate: null,
    swornInDate: null,
    swornIn: false,
  })
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)

  const [stepValidation, setStepValidation] = useState<StepValidation>({
    'Sworn In': false,
    'Pick Send Date': false,
  })

  const swornInDate = formData.swornInDate
  const scheduledDate = formData.scheduledDate
  useEffect(() => {
    setStepValidation((prev) => ({
      ...prev,
      'Sworn In': !!swornInDate,
      'Pick Send Date': !!scheduledDate,
    }))
  }, [swornInDate, scheduledDate])

  const officeName = useMemo(
    () => grammarizeOfficeName(positionName),
    [positionName],
  )
  const userName = useMemo(() => {
    if (user?.firstName && user?.lastName) {
      return `${user.firstName} ${user.lastName}`
    }
    return user?.name || `n/a`
  }, [user])

  const isSwornIn = formData.swornIn
  const question = isSwornIn ? sworninQuestion : personElectQuestion
  const composedMessage = useMemo(
    () => composePollMessage(question, userName, officeName),
    [question, userName, officeName],
  )
  // The preview is the text constituents get, with a name where the merge tag
  // goes.
  const demoMessageText = useMemo(
    () => composedMessage.replace(mergeTagToken('first_name', 'serve'), 'Jane'),
    [composedMessage],
  )

  const updateFormData = useCallback((updates: Partial<FormData>) => {
    setFormData((prev) => ({
      ...prev,
      ...updates,
    }))
  }, [])

  const setImageUrl = useCallback(
    (imageUrl: string | null) => {
      updateFormData({ imageUrl })
    },
    [updateFormData],
  )

  const setScheduledDate = useCallback(
    (scheduledDate: Date | undefined) => {
      updateFormData({ scheduledDate })
    },
    [updateFormData],
  )

  const setSwornInDate = useCallback(
    (swornInDate: Date | undefined) => {
      const isSwornIn = !swornInDate
        ? false
        : isBefore(new Date(), swornInDate)
          ? false
          : true
      updateFormData({
        swornInDate,
        swornIn: isSwornIn,
      })
      if (swornInDate) {
        trackEvent(EVENTS.ServeOnboarding.SwornInCompleted, {
          swornInDate: swornInDate.toISOString(),
          isSwornIn: isSwornIn,
        })
      }
    },
    [updateFormData],
  )

  const submitOnboarding = useCallback(async () => {
    try {
      setIsSubmitting(true)
      setSubmitError(null)

      if (!formData.swornInDate || !formData.scheduledDate) {
        throw new Error('Missing required fields')
      }

      const res = await clientRequest('POST /v1/polls/initial-poll', {
        question,
        imageUrl: formData.imageUrl ?? undefined,
        swornInDate: format(formData.swornInDate, 'yyyy-MM-dd'),
        scheduledLocalDate: format(formData.scheduledDate, 'yyyy-MM-dd'),
      })
      return res.data
    } catch (error) {
      console.error(error)
      setSubmitError(
        'Try again in a few minutes or contact us if the issue persists',
      )
      throw error
    } finally {
      setIsSubmitting(false)
    }
  }, [formData, question])

  const resetFormData = useCallback(() => {
    setFormData({
      imageUrl: null,
      scheduledDate: null,
      swornInDate: null,
      swornIn: false,
    })
    setSubmitError(null)
    setStepValidation({
      'Sworn In': false,
      'Pick Send Date': false,
    })
  }, [])

  return {
    formData,
    isSubmitting,
    submitError,
    setImageUrl,
    setSwornInDate,
    setScheduledDate,
    submitOnboarding,
    resetFormData,
    demoMessageText,
    user,
    stepValidation,
  }
}
