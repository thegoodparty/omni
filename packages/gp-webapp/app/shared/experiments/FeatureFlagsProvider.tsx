'use client'

import React, {
  ReactNode,
  useContext,
  useEffect,
  createContext,
  useRef,
  useState,
  useMemo,
  useCallback,
} from 'react'
import {
  Experiment,
  ExperimentClient,
  ExperimentUser,
  Variant,
} from '@amplitude/experiment-js-client'
import { noop, noopAsync } from '@shared/utils/noop'
import { getReadyAnalytics } from '@shared/utils/analytics'
import { useUser } from '@shared/hooks/useUser'
import { reportErrorToSentry } from '@shared/sentry'
import { buildUserTraits } from 'helpers/buildUserTraits'
import { NEXT_PUBLIC_AMPLITUDE_API_KEY } from 'appEnv'

interface FeatureFlagsContextValue {
  ready: boolean
  variant: (key: string, fallback?: Variant) => Variant
  all: () => Record<string, Variant>
  exposure: (key: string) => void
  refresh: () => Promise<void>
  clear: () => void
}

const defaultContextValue: FeatureFlagsContextValue = {
  ready: false,
  variant: () => ({ value: undefined }),
  all: () => ({}),
  exposure: noop,
  refresh: noopAsync,
  clear: noop,
}

export const FeatureFlagsContext =
  createContext<FeatureFlagsContextValue>(defaultContextValue)

interface FeatureFlagsProviderProps {
  children: ReactNode
}

export const FeatureFlagsProvider = ({
  children,
}: FeatureFlagsProviderProps): React.JSX.Element => {
  const clientRef = useRef<ExperimentClient | null>(null)
  const [ready, setReady] = useState<boolean>(false)
  const [rev, setRev] = useState<number>(0)
  const [user] = useUser()
  const prevUserIdRef = useRef<string | undefined>(undefined)

  const buildExperimentUser = useCallback((): ExperimentUser => {
    if (!user) return {}
    return {
      user_id: String(user.id),
      user_properties: buildUserTraits(user),
    }
  }, [user])

  const refresh = useCallback(async () => {
    const client = clientRef.current
    if (!client) return
    try {
      const currentUserId = user ? String(user.id) : undefined
      if (prevUserIdRef.current !== currentUserId) {
        client.clear()
        prevUserIdRef.current = currentUserId
      }
      await client.fetch(buildExperimentUser())
      setReady(true)
      setRev((v) => v + 1)
    } catch (error) {
      reportErrorToSentry(
        error instanceof Error ? error : new Error(String(error)),
        { context: 'FeatureFlagsProvider.refresh' },
      )
      setReady(true)
    }
  }, [buildExperimentUser, user])

  useEffect(() => {
    const key = NEXT_PUBLIC_AMPLITUDE_API_KEY
    if (!key) {
      console.warn('Experiment disabled: missing key')
      setReady(true)
      return
    }

    if (!clientRef.current) {
      clientRef.current = Experiment.initialize(key, {
        automaticExposureTracking: true,
        exposureTrackingProvider: {
          track: async (exposure) => {
            try {
              const analytics = await getReadyAnalytics()
              if (analytics && typeof analytics.track === 'function') {
                analytics.track('$exposure', exposure)
              }
            } catch (error) {
              reportErrorToSentry(
                error instanceof Error ? error : new Error(String(error)),
                { context: 'FeatureFlagsProvider.exposureTrack' },
              )
            }
          },
        },
      })
    }

    refresh()
  }, [refresh])

  const value = useMemo<FeatureFlagsContextValue>(() => {
    const client = clientRef.current
    return {
      ready,
      variant: (key: string, fallback?: Variant): Variant =>
        client
          ? client.variant(key, fallback)
          : (fallback ?? { value: undefined }),
      all: (): Record<string, Variant> => (client ? client.all() : {}),
      exposure: (key: string): void => client?.exposure(key),
      refresh,
      clear: (): void => client?.clear(),
    }
  }, [ready, refresh, rev])

  return (
    <FeatureFlagsContext.Provider value={value}>
      {children}
    </FeatureFlagsContext.Provider>
  )
}

export const useFeatureFlags = (): FeatureFlagsContextValue =>
  useContext(FeatureFlagsContext)

interface UseFlagOnResult {
  ready: boolean
  on: boolean
}

interface UseFlagOnOptions {
  // automaticExposureTracking is on, so client.variant() emits an Amplitude
  // exposure event. Pass false to read the flag without exposing the user
  // (via client.all(), which does not track) — for callers that read the flag
  // on a surface that isn't actually the experiment's treatment.
  trackExposure?: boolean
}

export const useFlagOn = (
  key: string,
  { trackExposure = true }: UseFlagOnOptions = {},
): UseFlagOnResult => {
  const { ready, variant, all } = useFeatureFlags()
  const v = trackExposure ? variant(key, { value: 'off' }) : all()[key]
  return { ready, on: v?.value === 'on' }
}
