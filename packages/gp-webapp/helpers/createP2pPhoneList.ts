import { clientFetch } from 'gpApi/clientFetch'
import { apiRoutes } from 'gpApi/routes'
import { VoterFileFilters } from 'helpers/types'
import { extractApiErrorInfo } from 'helpers/extractApiErrorInfo'

export type PhoneListInput = VoterFileFilters & { name?: string }

export interface PhoneListResponse {
  token: string
  // The PeerlyPhoneList row id — the handle the build-status poll keys off,
  // in hand from the moment the POST is accepted (before `token` necessarily
  // resolves to anything Peerly-side).
  buildId: string
}

export interface PhoneListError {
  message?: string
  errorCode?: string
  status?: number
}

export type PhoneListResult =
  | ({ ok: true } & PhoneListResponse)
  | ({ ok: false } & PhoneListError)

export interface PhoneListStatusResponse {
  phoneListId: number
  leadsLoaded: number
  // ENG-10808: surfaced from the capture row (ENG-10800/ENG-10801) so the
  // purchase review can explain why leadsLoaded is smaller than the saved
  // list's raw membership.
  excludedOptedOutCount: number
  excludedDuplicatePhoneCount: number
}

// The build-status poll's result, collapsed to the three states a caller
// cares about. `queued`/`building`/`processing` (gp-api's 202) and a
// transient fetch/HTTP failure both read as `building` here — there is
// nothing terminal to show for either, and the poll is meant to keep going.
export type PhoneListBuildStatusResult =
  | { buildStatus: 'building' }
  | ({ buildStatus: 'ready' } & PhoneListStatusResponse)
  | { buildStatus: 'failed'; buildError: string }

export const createP2pPhoneList = async (
  voterFileFilter: PhoneListInput | undefined,
  // Set only when the audience is a saved segment the user picked (not one
  // built ad-hoc from checkboxes) — gp-api resolves the saved filter's
  // persisted criteria as the base and treats these inline fields as
  // overrides, then stamps the id onto the phone list for provenance.
  voterFileFilterId?: number,
): Promise<PhoneListResult> => {
  try {
    if (!voterFileFilter) {
      console.error('Error creating phone list: voterFileFilter is undefined')
      return { ok: false }
    }

    const listName = voterFileFilter.name || `P2P Campaign ${Date.now()}`
    const resp = await clientFetch<PhoneListResponse>(
      apiRoutes.p2p.createPhoneList,
      {
        ...voterFileFilter,
        listName,
        ...(voterFileFilterId ? { voterFileFilterId } : {}),
      },
    )
    if (!resp.ok) {
      console.error('Error creating phone list:', resp.statusText)
      return {
        ok: false,
        status: resp.status,
        ...extractApiErrorInfo(resp.data),
      }
    }
    return { ok: true, ...resp.data }
  } catch (e) {
    console.error('error', e)
    return { ok: false }
  }
}

// A failed build's body (gp-api's `{ buildStatus: 'failed', buildError }`);
// the ready body carries no `buildStatus` field at all (identical shape to
// the token-status route's response), which is how the two are told apart
// below.
interface PhoneListBuildFailedBody {
  buildStatus: 'failed'
  buildError: string
}

export const getP2pPhoneListBuildStatus = async (
  buildId: string,
): Promise<PhoneListBuildStatusResult> => {
  try {
    const resp = await clientFetch<
      PhoneListStatusResponse | PhoneListBuildFailedBody
    >(apiRoutes.p2p.phoneListBuildStatus, {
      buildId,
    })
    // Accepted but still queued/building/processing — nothing terminal yet.
    if (resp.status === 202) {
      return { buildStatus: 'building' }
    }
    if (!resp.ok) {
      // A non-2xx here — a 5xx transport blip, or a 4xx (most plausibly a
      // buildId the client just created that gp-api hasn't replicated to
      // yet) — is not gp-api's authoritative failure signal; that's only
      // the 200 `{ buildStatus: 'failed' }` body handled below. `clientFetch`
      // never throws on an HTTP error (it resolves `{ ok: false }`), so
      // without this a transient server 5xx would falsely and permanently
      // end an otherwise-healthy build. Read any non-2xx the same as a
      // thrown network error: keep polling.
      console.error('Error fetching phone list build status:', resp.statusText)
      return { buildStatus: 'building' }
    }
    if ('buildStatus' in resp.data && resp.data.buildStatus === 'failed') {
      return { buildStatus: 'failed', buildError: resp.data.buildError }
    }
    return { buildStatus: 'ready', ...resp.data }
  } catch (e) {
    // A thrown fetch is a transient connectivity blip, not a server-reported
    // failure — read it the same as still-building so the poll keeps going
    // rather than flashing a false failure.
    console.error('error', e)
    return { buildStatus: 'building' }
  }
}
