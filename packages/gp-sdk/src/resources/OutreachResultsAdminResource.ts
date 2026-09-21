import type {
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

  getTarget = (outreachId: number): Promise<OutreachResultsTarget> =>
    this.getRequest<OutreachResultsTarget>(
      `${this.resourceBasePath}/${outreachId}`,
    )

  upload = (
    outreachId: number,
    input: OutreachResultsUploadRequest,
  ): Promise<OutreachResultsParseReport> =>
    this.postRequest<OutreachResultsParseReport>(
      `${this.resourceBasePath}/${outreachId}`,
      input,
    )
}
