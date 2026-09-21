import type {
  OutreachAwaitingResultsResponse,
  OutreachResultsParseReport,
} from '@goodparty_org/contracts'
import { fixtureGateway, fixturesEnabled } from './gateway.fixtures'
import type {
  OutreachResultsTarget,
  OutreachResultsUploadRequest,
} from './types'

// The single seam between this page and gp-api.
//
// The endpoints are task B2, which lands after module wiring. Nothing else in
// this route talks to the network, so pointing the page at the real routes is
// one edit to `liveGateway` below plus an SDK resource — no page, component or
// action changes.
//
// What B2 must provide (see the PR body for the same list):
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
  getTarget(outreachId: number): Promise<OutreachResultsTarget>
  upload(
    outreachId: number,
    input: OutreachResultsUploadRequest
  ): Promise<OutreachResultsParseReport>
}

// Thrown when the endpoints are not deployed. Distinguished from a real
// failure so the pages can say "not built yet" rather than "something went
// wrong", which is a different instruction to the person reading it.
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

const unavailable = (): never => {
  throw new OutreachResultsEndpointsUnavailableError()
}

// Replace each body with the SDK call once B2 and its SDK resource exist:
//
//   listAwaiting: () => gpAction((client) => client.outreachResultsAdmin.getQueue()),
//   getTarget: (id) => gpAction((client) => client.outreachResultsAdmin.getTarget(id)),
//   upload: (id, input) => gpAction((client) => client.outreachResultsAdmin.upload(id, input)),
//
// `gpAction` (`@/shared/util/gpClient.util`) already resolves the Clerk org to
// the right environment and carries the M2M token.
const liveGateway: OutreachResultsGateway = {
  listAwaiting: unavailable,
  getTarget: unavailable,
  upload: unavailable,
}

export function getOutreachResultsGateway(): OutreachResultsGateway {
  return fixturesEnabled() ? fixtureGateway : liveGateway
}
