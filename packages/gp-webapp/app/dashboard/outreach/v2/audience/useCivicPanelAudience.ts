import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { clientRequest } from 'gpApi/typed-request'
import { useServeCitizenPanelsFlag } from '@shared/experiments/serveCitizenPanelsFlag'
import { civicPanelSummaryQueryOptions } from 'app/dashboard/contacts/citizens-panel/civicPanelSummary.query'
import type { SegmentResponse } from 'app/dashboard/contacts/crm/shared/contacts-types'
import { CIVIC_PANEL_FILTER_KEY } from 'app/dashboard/contacts/crm/shared/recommendedListFilters.config'
import {
  CIVIC_PANEL_AUDIENCE_NAME,
  isCivicPanelAudienceList,
} from './civicPanelAudienceList.util'

export interface CivicPanelAudience {
  show: boolean
  members: number
  listId: number | null
  // Reuses the saved list or creates it, and returns its id without
  // selecting it: the step selects through `onSelect`, like the universe row.
  resolve: () => Promise<number | null>
  pending: boolean
  error: boolean
}

export const useCivicPanelAudience = ({
  isElectedOfficial,
  orgSlug,
  lists,
  listsQueryKey,
}: {
  isElectedOfficial: boolean
  orgSlug: string | undefined
  lists: SegmentResponse[]
  listsQueryKey: readonly unknown[]
}): CivicPanelAudience => {
  const flag = useServeCitizenPanelsFlag(false)
  const eligible =
    isElectedOfficial &&
    Boolean(orgSlug?.startsWith('eo-')) &&
    flag.ready &&
    flag.enabled
  const queryClient = useQueryClient()

  const summary = useQuery({
    ...civicPanelSummaryQueryOptions(orgSlug),
    enabled: eligible,
  })
  const members = summary.data?.members ?? 0
  const existing = lists.find(isCivicPanelAudienceList) ?? null

  const mutation = useMutation({
    mutationFn: async (): Promise<SegmentResponse> => {
      if (existing) return existing
      const { data } = await clientRequest(
        'POST /v1/voters/voter-file/filter',
        {
          name: CIVIC_PANEL_AUDIENCE_NAME,
          [CIVIC_PANEL_FILTER_KEY]: true,
        },
      )
      await queryClient.invalidateQueries({ queryKey: listsQueryKey })
      queryClient.invalidateQueries({ queryKey: ['custom-segments', orgSlug] })
      return data as SegmentResponse
    },
  })

  return {
    show: eligible && members > 0,
    members,
    listId: existing?.id ?? null,
    resolve: async () => {
      try {
        return (await mutation.mutateAsync()).id
      } catch {
        return null
      }
    },
    pending: mutation.isPending,
    error: mutation.isError,
  }
}
