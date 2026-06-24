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
import type { Variant } from '@amplitude/experiment-js-client'
import { noop, noopAsync } from '@shared/utils/noop'
import { getReadyAnalytics } from '@shared/utils/analytics'
import { useUser } from '@shared/hooks/useUser'
import { reportErrorToSentry } from '@shared/sentry'
import { buildUserTraits } from 'helpers/buildUserTraits'
import {
  ExperimentVariantsResponseSchema,
  type ExperimentVariants,
} from '@goodparty_org/contracts'

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
  // Variants resolved server-side by gp-api for the current user and embedded
  // in the SSR render. The client trusts these and re-resolves only through
  // gp-api (never Amplitude directly), so an ad blocker or blocked network can
  // never affect which gated surfaces render.
  initialVariants?: ExperimentVariants | null
}

// Same-origin webapp route that returns gp-api-resolved variants via
// getFlagVariants. The browser never calls Amplitude for flag resolution.
const VARIANTS_ROUTE = '/api/feature-flags'

export const FeatureFlagsProvider = ({
  children,
  initialVariants,
}: FeatureFlagsProviderProps): React.JSX.Element => {
  const hasSeed = !!initialVariants && Object.keys(initialVariants).length > 0
  const [variants, setVariants] = useState<Record<string, Variant>>(
    initialVariants ?? {},
  )
  const [ready, setReady] = useState<boolean>(hasSeed)
  const [user, , isUserLoading] = useUser()
  // Whether the first identity has settled, and the fingerprint of the user the
  // current variants reflect — so we re-resolve on a real change (login /
  // logout / impersonation / a segment-relevant trait edit), but not on the
  // transient anonymous flash during Clerk hydration.
  const resolvedRef = useRef<boolean>(false)
  const resolvedKeyRef = useRef<string | undefined>(undefined)
  // $exposure fires at most once per flag key per mount, matching the Amplitude
  // SDK's automatic-exposure dedup. Reset whenever the variant set is replaced.
  const exposedRef = useRef<Set<string>>(new Set())

  const trackExposure = useCallback((key: string, variant?: Variant): void => {
    if (exposedRef.current.has(key)) return
    exposedRef.current.add(key)
    void (async () => {
      try {
        const analytics = await getReadyAnalytics()
        if (analytics && typeof analytics.track === 'function') {
          analytics.track('$exposure', {
            flag_key: key,
            variant: variant?.value,
          })
        }
      } catch (error) {
        reportErrorToSentry(
          error instanceof Error ? error : new Error(String(error)),
          { context: 'FeatureFlagsProvider.exposureTrack' },
        )
      }
    })()
  }, [])

  // Re-resolve through gp-api (server-side), never from Amplitude in the
  // browser — so an ad blocker or blocked network can't affect flag resolution.
  const refresh = useCallback(async (): Promise<void> => {
    // Resolve to the gp-api result, or fail safe to empty. refresh() runs on
    // identity changes without pre-clearing, so a transient failure (non-ok,
    // unparseable, or network error) must NOT leave the previous identity's
    // variants in place — an unresolvable flag has to read off, never stale.
    let next: Record<string, Variant> = {}
    try {
      const res = await fetch(VARIANTS_ROUTE, { credentials: 'include' })
      if (res.ok) {
        const parsed = ExperimentVariantsResponseSchema.safeParse(
          await res.json(),
        )
        if (parsed.success) {
          next = parsed.data.variants
        }
      }
    } catch (error) {
      reportErrorToSentry(
        error instanceof Error ? error : new Error(String(error)),
        { context: 'FeatureFlagsProvider.refresh' },
      )
    } finally {
      setVariants(next)
      exposedRef.current = new Set()
      setReady(true)
    }
  }, [])

  useEffect(() => {
    if (isUserLoading) return
    // Fingerprint the identity by the same segment inputs gp-api/Amplitude
    // resolve on, so a same-session trait edit (e.g. zip) re-resolves too — not
    // just a user-id change.
    const key = user
      ? JSON.stringify({ id: user.id, traits: buildUserTraits(user) })
      : undefined

    if (!resolvedRef.current) {
      resolvedRef.current = true
      resolvedKeyRef.current = key
      // Trust the SSR seed only when the client confirms the same authed user.
      // A genuinely anonymous visitor (no seed, no user) likewise skips the
      // fetch and stays empty. But if the session expired between SSR and
      // hydration (seed present, user gone), the seed is for the wrong identity
      // — discard it and re-resolve through gp-api, which is cookie-authed
      // server-side and so returns the right answer even during Clerk's brief
      // anonymous flash (the old client-Amplitude refetch couldn't, which is why
      // the seed used to be kept here).
      if (hasSeed && user) {
        setReady(true)
        return
      }
      if (!hasSeed && !user) {
        setReady(true)
        return
      }
      void refresh()
      return
    }

    if (key === resolvedKeyRef.current) return
    resolvedKeyRef.current = key
    if (!user) {
      setVariants({})
      exposedRef.current = new Set()
      setReady(true)
      return
    }
    void refresh()
  }, [isUserLoading, user, hasSeed, refresh])

  const value = useMemo<FeatureFlagsContextValue>(
    () => ({
      ready,
      // Reading a variant is the experiment's treatment surface, so it emits an
      // exposure (deduped). all() deliberately does not — see useFlagOn's
      // trackExposure option.
      variant: (key: string, fallback?: Variant): Variant => {
        trackExposure(key, variants[key])
        return variants[key] ?? fallback ?? { value: undefined }
      },
      all: (): Record<string, Variant> => variants,
      exposure: (key: string): void => trackExposure(key, variants[key]),
      refresh,
      clear: (): void => {
        setVariants({})
        exposedRef.current = new Set()
      },
    }),
    [ready, variants, trackExposure, refresh],
  )

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
  // variant() emits an exposure event; all() does not. Pass false to read the
  // flag without exposing the user — for callers that read the flag on a
  // surface that isn't actually the experiment's treatment.
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
