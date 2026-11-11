'use client'

import type { PriorityResults } from '@goodparty_org/contracts'
import { useQuery } from '@tanstack/react-query'
import { Spinner } from '@styleguide'
import { clientRequest } from 'gpApi/typed-request'
import { RESULTS_COPY } from '../resultsCopy'
import { PriorityResultsView } from './PriorityResultsView'

export const priorityResultsQueryKey = (priorityId: string) => [
  'priority-results',
  priorityId,
]

// The results load in the browser, so the page never waits on gp-api's
// warehouse reads in its server render.
export const PriorityResultsLoader = ({
  priorityId,
  title,
}: {
  priorityId: string
  title: string
}) => {
  const query = useQuery({
    queryKey: priorityResultsQueryKey(priorityId),
    queryFn: async (): Promise<PriorityResults> => {
      const { data } = await clientRequest('GET /v1/priorities/:id/results', {
        id: priorityId,
      })
      return data
    },
    retry: false,
  })

  if (query.isPending) {
    return (
      <div className="mx-auto flex w-full max-w-3xl items-center gap-3 p-4 lg:p-6">
        <Spinner />
        <p className="text-sm text-muted-foreground">{RESULTS_COPY.loading}</p>
      </div>
    )
  }
  if (query.isError) {
    return (
      <div className="mx-auto w-full max-w-3xl p-4 lg:p-6">
        <p className="text-sm text-muted-foreground">
          {RESULTS_COPY.loadError}
        </p>
      </div>
    )
  }
  return (
    <PriorityResultsView
      priorityId={priorityId}
      title={title}
      results={query.data}
    />
  )
}
