import { FetchError } from 'ofetch'
import {
  OutreachDraftConflictSchema,
  type CreateOutreachDraftRequest,
  type OutreachDetail,
} from '@goodparty_org/contracts'
import {
  createOutreachDraft as createOutreachDraftApi,
  createRobocallDraft as createRobocallDraftApi,
} from 'gpApi/outreachDraft.api'

export interface CreateOutreachDraftResult {
  draft: OutreachDetail | null
  /**
   * The draft this campaign already holds for the channel (409). The flow
   * resumes that row rather than reporting a failure — the candidate has one
   * saved text, not a broken save.
   */
  conflictId: number | null
}

export const createOutreachDraft = async (
  payload: CreateOutreachDraftRequest,
  image: File | null = null,
): Promise<CreateOutreachDraftResult> => {
  try {
    const resp = await createOutreachDraftApi(payload, image)
    if (resp.status === 409) {
      const conflict = OutreachDraftConflictSchema.safeParse(resp.data)
      return {
        draft: null,
        conflictId: conflict.success ? conflict.data.existingId : null,
      }
    }
    if (!resp.ok) {
      console.error('Error creating outreach draft:', resp.statusText)
      return { draft: null, conflictId: null }
    }
    return { draft: resp.data ?? null, conflictId: null }
  } catch (e) {
    console.error('error creating outreach draft', e)
    return { draft: null, conflictId: null }
  }
}

/**
 * The robocall sibling: JSON rather than multipart, so the typed route
 * throws on a non-2xx instead of handing back a status to branch on. Same
 * result shape, so a flow reads the 409 the same way the texting one does.
 */
export const createRobocallDraft = async (
  payload: CreateOutreachDraftRequest,
): Promise<CreateOutreachDraftResult> => {
  try {
    const { data } = await createRobocallDraftApi(payload)
    return { draft: data ?? null, conflictId: null }
  } catch (e) {
    if (e instanceof FetchError && e.status === 409) {
      const conflict = OutreachDraftConflictSchema.safeParse(e.data)
      return {
        draft: null,
        conflictId: conflict.success ? conflict.data.existingId : null,
      }
    }
    console.error('error creating robocall draft', e)
    return { draft: null, conflictId: null }
  }
}
