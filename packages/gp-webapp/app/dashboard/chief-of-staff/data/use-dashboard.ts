'use client'

import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseQueryResult,
} from '@tanstack/react-query'
import { dashboardApi } from './dashboard-api'
import type {
  DashboardCard,
  DashboardCardBucket,
  OnboardingCard,
  OnboardingCardKey,
  SupportEstimate,
} from './contracts'

const SUPPORT_ESTIMATE_KEY = ['chief-of-staff', 'support-estimate'] as const

const ONBOARDING_CARDS_KEY = ['chief-of-staff', 'onboarding-cards'] as const

const cardsKey = (bucket: DashboardCardBucket) =>
  ['chief-of-staff', 'cards', bucket] as const

export const useSupportEstimate = (): UseQueryResult<SupportEstimate | null> =>
  useQuery({
    queryKey: SUPPORT_ESTIMATE_KEY,
    queryFn: () => dashboardApi.getSupportEstimate(),
  })

export const useDashboardCards = (
  bucket: DashboardCardBucket,
): UseQueryResult<DashboardCard[]> =>
  useQuery({
    queryKey: cardsKey(bucket),
    queryFn: () => dashboardApi.getCards(bucket),
  })

// Done and Skip both take the card off the active list at once, so the stack's
// next card comes forward without waiting on the round trip.
const useLeaveActiveCard = (leave: (id: string) => Promise<void>) => {
  const queryClient = useQueryClient()
  const activeKey = cardsKey('active')
  return useMutation({
    mutationFn: leave,
    onMutate: async (id: string) => {
      await queryClient.cancelQueries({ queryKey: activeKey })
      const previous = queryClient.getQueryData<DashboardCard[]>(activeKey)
      queryClient.setQueryData<DashboardCard[]>(activeKey, (cards) =>
        cards?.filter((card) => card.id !== id),
      )
      return { previous }
    },
    onError: (_err, _id, context) => {
      queryClient.setQueryData(activeKey, context?.previous)
    },
    onSettled: () => {
      // The card moves into another bucket (skipped or done), so refetch
      // every cards list rather than trying to mutate each bucket's cache.
      void queryClient.invalidateQueries({
        queryKey: ['chief-of-staff', 'cards'],
      })
    },
  })
}

export const useDismissCard = () => useLeaveActiveCard(dashboardApi.dismissCard)

export const useCompleteCard = () =>
  useLeaveActiveCard(dashboardApi.completeCard)

export const useSnoozeCard = () => useLeaveActiveCard(dashboardApi.snoozeCard)

export const useRestoreCard = () => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: dashboardApi.restoreCard,
    onSettled: () => {
      void queryClient.invalidateQueries({
        queryKey: ['chief-of-staff', 'cards'],
      })
    },
  })
}

export const useOnboardingCards = (): UseQueryResult<OnboardingCard[]> =>
  useQuery({
    queryKey: ONBOARDING_CARDS_KEY,
    queryFn: () => dashboardApi.getOnboardingCards(),
  })

export const useSkipOnboardingCard = () => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (key: OnboardingCardKey) =>
      dashboardApi.skipOnboardingCard(key),
    onMutate: async (key: OnboardingCardKey) => {
      await queryClient.cancelQueries({ queryKey: ONBOARDING_CARDS_KEY })
      const previous =
        queryClient.getQueryData<OnboardingCard[]>(ONBOARDING_CARDS_KEY)
      queryClient.setQueryData<OnboardingCard[]>(
        ONBOARDING_CARDS_KEY,
        (cards) =>
          cards?.map((card) =>
            card.key === key ? { ...card, status: 'skipped' } : card,
          ),
      )
      return { previous }
    },
    onError: (_err, _key, context) => {
      queryClient.setQueryData(ONBOARDING_CARDS_KEY, context?.previous)
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ONBOARDING_CARDS_KEY })
    },
  })
}
