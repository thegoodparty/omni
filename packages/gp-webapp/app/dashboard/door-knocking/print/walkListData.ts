import { FetchError } from 'ofetch'
import { DoorKnockingRoutePayload } from '@goodparty_org/contracts'
import { serverRequest } from 'gpApi/server-request'

// Both paper surfaces — the printable page and the downloadable PDF — read the
// same route the same way. They are the same document in two formats, so a
// difference in what either one treats as "no such list" would be a bug in one
// of them rather than a choice.
export const fetchRoute = async (
  turfId: string,
): Promise<DoorKnockingRoutePayload | null> => {
  try {
    const response = await serverRequest(
      'GET /v1/door-knocking/turfs/:id/route',
      {
        id: turfId,
      },
    )
    return response.data
  } catch (error) {
    // gp-api 404s every "nothing to show" case — a turf that isn't yours,
    // doesn't exist, or was never knocked — and the sheet has nothing useful
    // to say about any of them. Anything else (a 500, a timeout) is a
    // different problem, and swallowing it would hand someone chasing signal
    // a "not found" page for a route that exists, with no hint to retry.
    if (error instanceof FetchError && error.status === 404) return null
    throw error
  }
}

// The name is decoration; the route is the sheet. If this read fails the
// walk list is still complete and worth printing, so it degrades to a
// generic title rather than taking the page down with it.
export const fetchTurfName = async (turfId: string): Promise<string> => {
  try {
    const response = await serverRequest('GET /v1/door-knocking/turfs', {})
    const turf = response.data.find((entry) => String(entry.id) === turfId)
    return turf?.name ?? 'Walk list'
  } catch {
    return 'Walk list'
  }
}
