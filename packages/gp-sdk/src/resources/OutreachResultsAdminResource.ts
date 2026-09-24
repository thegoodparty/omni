import type {
  ResultsInboxKind,
  OutreachAwaitingResultsResponse,
  OutreachResultsParseReport,
  OutreachResultsTarget,
  OutreachResultsUploadRequest,
} from '@goodparty_org/contracts'
import { BaseResource } from './BaseResource'

// The staff results surface (results inbox + per-send upload) — gp-api's
// /outreach/admin/results surface, AdminOrM2M-gated.
//
// `upload` carries the raw file text rather than parsed rows: the server is
// the authority on what the file says, and gp-admin's own parse is a
// preflight that saves a round trip. The same call does the dry run and the
// commit; `dryRun` in the body is the difference.
export class OutreachResultsAdminResource extends BaseResource {
  protected readonly resourceBasePath = '/outreach/admin/results'

  getQueue = (): Promise<OutreachAwaitingResultsResponse> =>
    this.getRequest<OutreachAwaitingResultsResponse>(
      `${this.resourceBasePath}/queue`,
    )

  // Addressed as `<kind>/<id>` because the inbox carries two products whose
  // ids are neither the same type nor drawn from the same space: a send is
  // an integer Outreach key, a poll is a uuid. The caller takes both from
  // the queue item rather than assembling them.
  getTarget = (
    kind: ResultsInboxKind,
    id: string,
  ): Promise<OutreachResultsTarget> =>
    this.getRequest<OutreachResultsTarget>(
      `${this.resourceBasePath}/${kind}/${id}`,
    )

  upload = (
    kind: ResultsInboxKind,
    id: string,
    input: OutreachResultsUploadRequest,
  ): Promise<OutreachResultsParseReport> =>
    this.postRequest<OutreachResultsParseReport>(
      `${this.resourceBasePath}/${kind}/${id}`,
      input,
    )
}
