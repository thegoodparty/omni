'use client'

import { faro } from '@grafana/faro-web-sdk'
import { ReplayInstrumentation } from '@grafana/faro-instrumentation-replay'
import { useEffect } from 'react'
import { useUser } from '@shared/hooks/useUser'
import { useCampaign } from '@shared/hooks/useCampaign'
import { useOrganization } from '@shared/organization-picker'
import { isTestUser } from 'helpers/test-users'

export const ObservabilityIdentifier: React.FC = () => {
  const [user] = useUser()
  const [campaign] = useCampaign()
  const organization = useOrganization()

  const userId = user?.id
  const email = user?.email

  useEffect(() => {
    // Added here rather than in instrumentation-client.ts so that only
    // signed-in users are recorded. Adding it a second time would corrupt the
    // recording.
    if (
      email &&
      !isTestUser({ email }) &&
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
