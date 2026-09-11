/**
 * Whether a priority already has an ordinance being drafted for it, and how to
 * start one if not.
 *
 * Matched on `sourcePriorityId`, which seeding now sets. The title-text
 * fallback below is for rows created before that column existed: seeding has
 * always copied the priority's title into `goalText`, so an older draft is
 * still findable, and dropping the fallback would orphan every ordinance
 * started before this. New rows never need it.
 */

'use client'

import { useMutation, useQuery } from '@tanstack/react-query'
import { clientRequest } from 'gpApi/typed-request'
import { reportErrorToSentry } from '@shared/sentry'
import type { OrdinanceSummary, Priority } from '@goodparty_org/contracts'
import { isOrdinanceStep } from 'app/dashboard/ordinances/data/steps'
import { createOrdinance } from 'app/dashboard/ordinances/data/ordinances-api'

const ORDINANCES_KEY = ['chief-of-staff', 'ordinances'] as const

// Where to drop someone back into a draft they have already started. The flow
// records `lastViewedStep`; clarify is the first step, so it is the fallback
// for a row that has not recorded one yet.
export const ordinanceHref = (row: OrdinanceSummary): string => {
  const step =
    row.lastViewedStep && isOrdinanceStep(row.lastViewedStep)
      ? row.lastViewedStep
      : 'clarify'
  return `/dashboard/ordinances/solve/${row.slug}/${step}`
}

const normalize = (value: string): string => value.trim().toLowerCase()

interface UsePriorityOrdinanceResult {
  /** The in-flight draft for this priority, if we can find one. */
  existing: OrdinanceSummary | undefined
  /** True until we know, so the CTA does not offer to start a duplicate. */
  isPending: boolean
  start: () => void
  isStarting: boolean
  hasError: boolean
}

export const usePriorityOrdinance = (
  priority: Priority,
  onStarted: (href: string) => void,
): UsePriorityOrdinanceResult => {
  const { data, isPending } = useQuery({
    queryKey: ORDINANCES_KEY,
    queryFn: async () => {
      const { data: list } = await clientRequest('GET /v1/ordinances', {})
      return list.items
    },
  })

  const existing =
    data?.find((row) => row.sourcePriorityId === priority.id) ??
    data?.find(
      (row) =>
        row.sourcePriorityId === null &&
        row.goalText &&
        normalize(row.goalText) === normalize(priority.title),
    )

  const start = useMutation({
    mutationFn: async (): Promise<string> => {
      const ordinance = await createOrdinance({
        seedType: 'new',
        goalText: priority.title,
        sourcePriorityId: priority.id,
      })
      return `/dashboard/ordinances/solve/${ordinance.slug}/clarify`
    },
    onSuccess: onStarted,
    onError: (err) =>
      reportErrorToSentry(err, {
        surface: 'chief-of-staff-onboarding',
        phase: 'start-ordinance',
      }),
  })

  return {
    existing,
    isPending,
    start: () => start.mutate(),
    isStarting: start.isPending,
    hasError: start.isError,
  }
}
