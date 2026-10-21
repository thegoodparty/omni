import { reportErrorToSentry } from '@shared/sentry'
import { createOutreach as createOutreachApi } from 'gpApi/outreach.api'
import type {
  CreateOutreachPayload,
  CreateOutreachResponse,
} from 'gpApi/outreach.api'

/** Same shape as CreateOutreachResponse for backward compatibility (id as number). */
export type { CreateOutreachResponse as OutreachResponse } from 'gpApi/outreach.api'

export type { CreateOutreachPayload } from 'gpApi/outreach.api'

/**
 * Create an outreach via the typed API. Returns the created outreach or null.
 */
export async function createOutreach(
  payload: CreateOutreachPayload,
  image: File | null = null,
  // Told why the server refused, so a caller can say more than "it failed".
  onRejected?: (message: string | null) => void,
): Promise<CreateOutreachResponse | null> {
  try {
    const resp = await createOutreachApi(payload, image)
    if (!resp.ok) {
      console.error('Error creating outreach:', resp.statusText)
      const message = (resp.data as { message?: unknown } | null)?.message
      onRejected?.(typeof message === 'string' ? message : null)
      return null
    }
    const data = resp.data
    if (data == null) return null
    return data
  } catch (e) {
    // A throw here means the request never got an answer, so gp-api has no
    // log of it and this report is the only trace the attempt leaves.
    console.error('error creating outreach', e)
    reportErrorToSentry(e, {
      context: 'createOutreach',
      outreachType: payload.outreachType,
      hasImage: image !== null,
      imageBytes: image?.size,
    })
    return null
  }
}
