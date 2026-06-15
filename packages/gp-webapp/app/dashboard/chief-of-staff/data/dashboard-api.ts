/**
 * Typed client for the Chief of Staff dashboard JSON endpoints.
 *
 * INTEGRATION SEAM: these routes (`/v1/dashboard/support-estimate`,
 * `/v1/dashboard/cards`, `/v1/dashboard/cards/:id/dismiss`) are not yet
 * registered in `gpApi/api-endpoints.ts` (the backend slices that own them are
 * not merged), so we cannot use the typed `clientRequest` helper. We go through
 * the same-origin `/api` proxy with raw `fetch` instead — the same transport
 * the briefing chat SSE path uses — and attach the `X-Organization-Slug`
 * header from the cookie so gp-api's `@UseElectedOffice` resolves the office.
 *
 * At integration, once the routes land in `api-endpoints.ts`, these can move to
 * `clientRequest('GET /v1/dashboard/cards', ...)` etc. with no change to the
 * call sites (they go through these functions).
 */

'use client'

import { getCookie } from 'helpers/cookieHelper'
import {
  ORG_SLUG_COOKIE,
  ORG_SLUG_HEADER,
} from '@shared/organizations/constants'
import { reportErrorToSentry } from '@shared/sentry'
import type {
  DashboardCard,
  DashboardCardBucket,
  DashboardCardListResponse,
  SupportEstimate,
} from './contracts'

function orgHeaders(): Record<string, string> {
  const slug = getCookie(ORG_SLUG_COOKIE)
  return slug ? { [ORG_SLUG_HEADER]: slug } : {}
}

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method: 'GET',
    credentials: 'include',
    headers: { Accept: 'application/json', ...orgHeaders() },
  })
  if (!res.ok) {
    throw new Error(`${path} responded ${res.status}`)
  }
  return (await res.json()) as T
}

export const dashboardApi = {
  async getSupportEstimate(): Promise<SupportEstimate> {
    return getJson<SupportEstimate>('/v1/dashboard/support-estimate')
  },

  async getCards(bucket: DashboardCardBucket): Promise<DashboardCard[]> {
    const data = await getJson<DashboardCardListResponse>(
      `/v1/dashboard/cards?bucket=${encodeURIComponent(bucket)}`,
    )
    return data.cards
  },

  async dismissCard(id: string): Promise<void> {
    const res = await fetch(
      `/api/v1/dashboard/cards/${encodeURIComponent(id)}/dismiss`,
      {
        method: 'PUT',
        credentials: 'include',
        headers: { Accept: 'application/json', ...orgHeaders() },
      },
    )
    if (!res.ok) {
      const err = new Error(`dismiss card responded ${res.status}`)
      reportErrorToSentry(err, {
        surface: 'chief-of-staff-dashboard',
        phase: 'dismiss-card',
        cardId: id,
        status: res.status,
      })
      throw err
    }
  },
}
