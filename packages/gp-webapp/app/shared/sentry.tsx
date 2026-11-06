'use client'

import * as Sentry from '@sentry/nextjs'
import { faro } from '@grafana/faro-web-sdk'
import { ReplayInstrumentation } from '@grafana/faro-instrumentation-replay'
import { useUser } from './hooks/useUser'
import { useCampaign } from './hooks/useCampaign'
import { useEffect } from 'react'
import { isTestUser } from 'helpers/test-users'
import { useOrganization } from './organization-picker'

export const reportErrorToSentry = (
  error: unknown,
  customAttributes?: Partial<Record<string, unknown>>,
) => {
  const reportable =
    error instanceof Error
      ? error
      : new Error(typeof error === 'string' ? error : JSON.stringify(error))
  Sentry.captureException(reportable, {
    extra: customAttributes,
  })
  // `faro.api` exists only once instrumentation-client.ts has initialized
  // Faro, which it skips where no collector is configured.
  faro.api?.pushError(reportable, {
    context: Object.fromEntries(
      Object.entries(customAttributes ?? {}).map(([key, value]) => [
        key,
        typeof value === 'string' ? value : (JSON.stringify(value) ?? ''),
      ]),
    ),
  })
}

export const SentryIdentifier: React.FC = () => {
  const [user] = useUser()
  const [campaign] = useCampaign()
  const organization = useOrganization()

  const userId = user?.id
  const email = user?.email

  useEffect(() => {
    if (userId) {
      Sentry.setUser({
        id: userId.toString(),
        email: email || undefined,
      })
    }

    if (campaign) {
      Sentry.setTag('campaignSlug', campaign.slug)
    }

    if (organization) {
      Sentry.setTag('organizationSlug', organization.slug)
    }

    // Always record sessions for logged-in users (but not test users)
    if (email && !isTestUser({ email })) {
      const replay = Sentry.getReplay()
      replay?.start()

      // Added here rather than in instrumentation-client.ts so that, as with
      // Sentry, only signed-in users are recorded. Adding it a second time
      // would corrupt the recording.
      if (
        faro.instrumentations &&
        !faro.instrumentations.instrumentations.some(
          (instrumentation) => instrumentation instanceof ReplayInstrumentation,
        )
      ) {
        faro.instrumentations.add(
          new ReplayInstrumentation({
            maskAllInputs: true,
            // Overrides the default '*', which masks every piece of text.
            maskTextSelector: undefined,
          }),
        )
      }
    }

    // E2E and QA accounts send nothing to Grafana: their sessions are the bulk
    // of dev and preview traffic, and Frontend Observability bills by session.
    if (email && isTestUser({ email })) {
      faro.pause?.()
    } else if (userId) {
      faro.api?.setUser({
        id: userId.toString(),
        email: email || undefined,
        attributes: {
          ...(campaign ? { campaignSlug: campaign.slug } : {}),
          ...(organization ? { organizationSlug: organization.slug } : {}),
        },
      })
    }
  }, [userId, email, campaign, organization])

  return null
}
