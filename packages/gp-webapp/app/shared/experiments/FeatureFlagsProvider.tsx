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
import type { ExperimentVariants } from '@goodparty_org/contracts'

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
  // Variants resolved server-side by gp-api for the current user. When present,
  // the client trusts them (correct on first paint, no Amplitude round-trip)
  // and skips the initial client fetch.
  initialVariants?: ExperimentVariants | null
}

export const FeatureFlagsProvider = ({
  children,
  initialVariants,
}: FeatureFlagsProviderProps): React.JSX.Element => {
  const clientRef = useRef<ExperimentClient | null>(null)
  const hasSeed = !!initialVariants && Object.keys(initialVariants).length > 0
  const [ready, setReady] = useState<boolean>(hasSeed)
  const [rev, setRev] = useState<number>(0)
  const [user, , isUserLoading] = useUser()
  const prevUserIdRef = useRef<string | undefined>(undefined)
  // The experiment user (id + traits) last sent to Amplitude. The fetch effect
  // keys its skip-refetch decision on this, not just the id, so a trait change
  // (email/name/phone/zip — all segment inputs) on the same user still refetches.
  const lastFetchedKeyRef = useRef<string | undefined>(undefined)
  // The server-seeded variants already cover the first resolved user, so the
  // first identity resolution should adopt that user without refetching (a
  // blocked client fetch could otherwise wipe the seed and bounce the user).
  const seededRef = useRef<boolean>(hasSeed)

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
      const experimentUser = buildExperimentUser()
      await client.fetch(experimentUser)
      lastFetchedKeyRef.current = JSON.stringify(experimentUser)
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

  // Initialize the client once. fetchOnStart is disabled so the SDK never
  // evaluates against an empty (pre-hydration) user; we drive fetching from the
  // effect below once the user is known. initialVariants seeds the store so
  // gated surfaces render immediately when the server resolved them.
  useEffect(() => {
    const key = NEXT_PUBLIC_AMPLITUDE_API_KEY
    if (!key) {
      console.warn('Experiment disabled: missing key')
      setReady(true)
      return
    }
    if (clientRef.current) return

    clientRef.current = Experiment.initialize(key, {
      automaticExposureTracking: true,
      fetchOnStart: false,
      initialVariants: hasSeed ? (initialVariants ?? undefined) : undefined,
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
  }, [hasSeed, initialVariants])

  // Fetch only once the user identity is settled. Gating on isUserLoading
  // prevents the userless evaluation that would resolve gated flags to their
  // default (off) and redirect an enabled user mid-hydration.
  useEffect(() => {
    if (!clientRef.current) return
    if (isUserLoading) return

    const currentUserId = user ? String(user.id) : undefined
    const fetchKey = JSON.stringify(buildExperimentUser())
    if (seededRef.current) {
      seededRef.current = false
      // The seed was resolved server-side for the authenticated SSR user. Trust
      // it only if the client confirms an authenticated user; if the client
      // resolved anonymous, the seed is for the wrong identity, so discard it
      // and fetch as the actual (anonymous) user instead.
      if (user) {
        prevUserIdRef.current = currentUserId
        lastFetchedKeyRef.current = fetchKey
        setReady(true)
        return
      }
      clientRef.current.clear()
      refresh()
      return
    }
    if (lastFetchedKeyRef.current === fetchKey && ready) return
    refresh()
  }, [isUserLoading, user, refresh, ready, buildExperimentUser])

  const value = useMemo<FeatureFlagsContextValue>(() => {
    const client = clientRef.current
    // `ready` starts true whenever the server seeded variants, but the SDK
    // client is created in a post-commit effect. The seed stands in only for
    // that pre-client window — otherwise a ready provider reports every flag as
    // its default (off) and a route guard bounces a user whose seed said the
    // flag was on. Once the client exists it is authoritative (it was
    // initialized with the seed), so reads go straight to it. Falling back to
    // the seed after the client exists would be sticky: a user with zero live
    // assignments has an empty client store indistinguishable from pre-fetch,
    // and a seeded `on` flag would never clear.
    const seed: Record<string, Variant> = initialVariants ?? {}
    return {
      ready,
      variant: (key: string, fallback?: Variant): Variant =>
        client
          ? client.variant(key, fallback)
          : (seed[key] ?? fallback ?? { value: undefined }),
      all: (): Record<string, Variant> => (client ? client.all() : seed),
      exposure: (key: string): void => client?.exposure(key),
      refresh,
      clear: (): void => client?.clear(),
    }
  }, [ready, refresh, rev, initialVariants])

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
