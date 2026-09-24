import type {
  ResultsInboxKind,
  OutreachAwaitingResultsResponse,
  OutreachResultsParseReport,
} from '@goodparty_org/contracts'
import { gpAction } from '@/shared/util/gpClient.util'
import { fixtureGateway, fixturesEnabled } from './gateway.fixtures'
import type {
  OutreachResultsTarget,
  OutreachResultsUploadRequest,
} from './types'

// The single seam between this page and gp-api.
//
// Task B2 built these endpoints and the SDK resource, so `liveGateway` below
// now calls them. No page, component or action changed.
//
// What it provides:
//
//   GET  /v1/outreach/admin/results/queue        -> OutreachAwaitingResultsResponse
//   GET  /v1/outreach/admin/results/:outreachId  -> OutreachResultsTarget
//   POST /v1/outreach/admin/results/:outreachId  -> OutreachResultsParseReport
//        body: OutreachResultsUploadRequest
//
// All three behind `AdminOrM2MGuard`, the same guard the CAS SMS console uses.
// In the SDK that is one resource with `resourceBasePath = '/outreach/admin/
// results'`; the `/v1` prefix comes from GP_API_ROOT_PATH.
//
// The upload carries the raw file text rather than parsed rows on purpose: a
// poll's results have to reach `input/<pollId>.csv` byte for byte, so the
// server needs the file the operator actually looked at. The page's own parse
// is a preflight — it catches a wrong file before a round trip and never
// decides anything.

export interface OutreachResultsGateway {
  listAwaiting(): Promise<OutreachAwaitingResultsResponse>
  // `kind` + `id` rather than a bare outreach id: the inbox carries text
  // sends and polls, whose ids are neither the same type nor from the same
  // space. Callers take both off the queue item.
  getTarget(kind: ResultsInboxKind, id: string): Promise<OutreachResultsTarget>
  upload(
    kind: ResultsInboxKind,
    id: string,
    input: OutreachResultsUploadRequest
  ): Promise<OutreachResultsParseReport>
}

// Thrown when the endpoints are not deployed. Distinguished from a real
// failure so the pages can say "not built yet" rather than "something went
// wrong", which is a different instruction to the person reading it.
//
// Nothing throws it now that the routes exist. It stays because the pages
// still branch on it, and because an environment that is behind on gp-api
// deploys is exactly when a caller wants that sentence back; deleting it
// would mean editing two pages to gain nothing.
export class OutreachResultsEndpointsUnavailableError extends Error {
  constructor() {
    super(
      'The results upload endpoints are not deployed yet (serve-sms task B2). ' +
        'Set OUTREACH_RESULTS_FIXTURES=1 to exercise this page against sample data.'
    )
    this.name = 'OutreachResultsEndpointsUnavailableError'
  }
}

// Name as well as instance: a server action can hand a page a re-created
// Error whose prototype chain did not survive the boundary.
export const isEndpointsUnavailable = (error: unknown): boolean =>
  error instanceof OutreachResultsEndpointsUnavailableError ||
  (error instanceof Error &&
    error.name === 'OutreachResultsEndpointsUnavailableError')

// `gpAction` resolves the Clerk org to the right environment and carries the
// M2M token, so each body is just the route.
const liveGateway: OutreachResultsGateway = {
  listAwaiting: () =>
    gpAction((client) => client.outreachResultsAdmin.getQueue()),
  getTarget: (kind, id) =>
    gpAction((client) => client.outreachResultsAdmin.getTarget(kind, id)),
  upload: (kind, id, input) =>
    gpAction((client) => client.outreachResultsAdmin.upload(kind, id, input)),
}

export function getOutreachResultsGateway(): OutreachResultsGateway {
  return fixturesEnabled() ? fixtureGateway : liveGateway
}
