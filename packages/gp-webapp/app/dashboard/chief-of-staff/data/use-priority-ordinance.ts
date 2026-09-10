/**
 * Whether a priority already has an ordinance being drafted for it, and how to
 * start one if not.
 *
 * There is no foreign key between the two. Seeding an ordinance from a priority
 * copies the priority's title into `goalText` (see MyPriorityIssuesSection),
 * so that is the join: a soft one, matched on exact text. It reliably finds an
 * ordinance seeded from this priority and deliberately will not find one the
 * official started by hand with different wording — in which case the worst
 * case is offering to start one, not losing their draft. A real
 * `sourcePriorityId` column would replace this.
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

  const existing = data?.find(
    (row) =>
      row.goalText && normalize(row.goalText) === normalize(priority.title),
  )

  const start = useMutation({
    mutationFn: async (): Promise<string> => {
      const ordinance = await createOrdinance({
        seedType: 'new',
        goalText: priority.title,
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
