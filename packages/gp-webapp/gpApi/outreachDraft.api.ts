import type {
  CreateOutreachDraftRequest,
  OutreachDetail,
} from '@goodparty_org/contracts'
import { packageFormData } from 'helpers/packageFormData'
import { clientFetch } from './clientFetch'
import type { ApiResponse } from './clientFetch'
import { apiRoutes } from './routes'

/**
 * Save an outreach as a draft (POST /outreach/drafts). Multipart always: a
 * texting draft carries its image on the same request, and the server reads
 * every field as a string.
 */
export const createOutreachDraft = async (
  payload: CreateOutreachDraftRequest,
  image: File | null = null,
): Promise<ApiResponse<OutreachDetail | null>> =>
  clientFetch<OutreachDetail | null>(
    apiRoutes.outreach.drafts,
    packageFormData({ ...payload }, image),
  )
