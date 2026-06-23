/**
 * Typed client for the Chief of Staff dashboard JSON endpoints.
 *
 * Routes are registered in `gpApi/api-endpoints.ts`, so these go through the
 * typed `clientRequest` helper: it attaches the org-slug header from the cookie
 * (so gp-api's `@UseElectedOffice` resolves the office), proxies via `/api`,
 * and throws on non-2xx.
 */

'use client'

import { clientRequest } from 'gpApi/typed-request'
import { reportErrorToSentry } from '@shared/sentry'
import type {
  DashboardCard,
  DashboardCardBucket,
  OnboardingCard,
  OnboardingCardKey,
  SupportEstimate,
} from './contracts'

export const dashboardApi = {
  async getSupportEstimate(): Promise<SupportEstimate | null> {
    const { data } = await clientRequest(
      'GET /v1/elected-office/support-estimate',
      {},
    )
    return data
  },

  async getCards(bucket: DashboardCardBucket): Promise<DashboardCard[]> {
    const { data } = await clientRequest('GET /v1/dashboard/cards', { bucket })
    return data.cards
  },

  async dismissCard(id: string): Promise<void> {
    try {
      await clientRequest('PUT /v1/dashboard/cards/:id/dismiss', { id })
    } catch (err) {
      reportErrorToSentry(err, {
        surface: 'chief-of-staff-dashboard',
        phase: 'dismiss-card',
        cardId: id,
      })
      throw err
    }
  },

  async getOnboardingCards(): Promise<OnboardingCard[]> {
    const { data } = await clientRequest(
      'GET /v1/dashboard/onboarding-cards',
      {},
    )
    return data.cards
  },

  async skipOnboardingCard(key: OnboardingCardKey): Promise<void> {
    try {
      await clientRequest('PUT /v1/dashboard/onboarding-cards/:key/skip', {
        key,
      })
    } catch (err) {
      reportErrorToSentry(err, {
        surface: 'chief-of-staff-dashboard',
        phase: 'skip-onboarding-card',
        cardKey: key,
      })
      throw err
    }
  },
}
