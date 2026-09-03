import { clientFetch } from './clientFetch'
import { packageFormData } from 'helpers/packageFormData'
import { apiRoutes } from './routes'
import type { ApiResponse } from './clientFetch'
import type {
  CreateOutreachPayload,
  CreateOutreachResponse,
} from './types/outreach.types'

export type {
  CreateOutreachPayload,
  CreateOutreachResponse,
  OutreachType,
} from './types/outreach.types'

/**
 * Create an outreach (POST /outreach). Returns the created Outreach with voterFileFilter.
 * Pass payload + optional image; body is built as FormData when image is present, else JSON.
 */
export async function createOutreach(
  payload: CreateOutreachPayload,
  image: File | null = null,
): Promise<ApiResponse<CreateOutreachResponse | null>> {
  if (image) {
    const formData = packageFormData({ ...payload }, image)
    return clientFetch<CreateOutreachResponse>(
      apiRoutes.outreach.create,
      formData,
    )
  }
  return clientFetch<CreateOutreachResponse>(apiRoutes.outreach.create, payload)
}

export interface UpdateOutreachPayload {
  name: string
  script: string
  date: string
}

/**
 * Edit a scheduled-not-sent SMS campaign (PATCH /outreach/:id): name, script,
 * send date, optional replacement image. The audience is not editable —
 * that path is cancel-and-recreate. Pre-compliance-launch only: the server
 * rejects once the launch switch is on.
 */
export async function updateOutreach(
  id: number,
  payload: UpdateOutreachPayload,
  image: File | null = null,
): Promise<ApiResponse<CreateOutreachResponse | null>> {
  // The path is substituted here rather than via route params because the
  // multipart branch's FormData body can't carry them for buildUrl.
  const endpoint = { ...apiRoutes.outreach.update, path: `/outreach/${id}` }
  if (image) {
    const formData = packageFormData({ ...payload }, image)
    return clientFetch<CreateOutreachResponse>(endpoint, formData)
  }
  return clientFetch<CreateOutreachResponse>(endpoint, payload)
}
