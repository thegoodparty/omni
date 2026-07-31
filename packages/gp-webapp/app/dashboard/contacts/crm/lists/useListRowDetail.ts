import { useQuery } from '@tanstack/react-query'
import { clientRequest } from 'gpApi/typed-request'
import { useOrganization } from '@shared/organization-picker'

// The lists index has no bulk "count + last outreach" endpoint (task-07 only
// shipped the single-list detail shape) — this fetches GET
// /v1/contacts/list-detail per row so the table can show a refreshed people
// count and the most recent outreach entry (outreachHistory[0]) without
// duplicating the aggregate logic gp-api already computes for the detail
// page. Acceptable N+1 for the small number of saved lists an org has today;
// revisit with a bulk endpoint if that changes.
// Exported so other callers that need the raw list-detail payload (e.g. the
// robocall audience step's cost-preview fetch, ENG-10764) hit the same call
// site instead of hand-rolling the clientRequest + field access again.
export const fetchListDetail = (segmentId: number) =>
  clientRequest('GET /v1/contacts/list-detail', {
    segment: segmentId,
  }).then((res) => res.data)

export const useListRowDetail = (segmentId: number) => {
  const orgSlug = useOrganization()?.slug

  const query = useQuery({
    queryKey: ['list-detail', orgSlug, segmentId],
    queryFn: () => fetchListDetail(segmentId),
  })

  return {
    peopleCount: query.data?.demographics.people,
    lastOutreach: query.data?.outreachHistory[0],
    isLoading: query.isLoading,
    isError: query.isError,
  }
}
