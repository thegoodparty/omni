'use server'

import { auth } from '@clerk/nextjs/server'
import { revalidatePath } from 'next/cache'
import { SdkError } from '@/shared/gpApi'
import { PERMISSIONS } from '@/lib/permissions'
import { extractApiErrorMessage } from '@/lib/utils/sdkError'
import { gpAction } from '@/shared/util/gpClient.util'
import type { EmailPausedSendsResponse } from '@goodparty_org/contracts'

const ADMIN_ROLE = 'org:admin'

export type EmailSendActionResult = { error: string | null }

export const getPausedEmailSends =
  async (): Promise<EmailPausedSendsResponse> => {
    const { has } = await auth()
    if (!has?.({ permission: PERMISSIONS.READ_CAMPAIGNS })) {
      throw new Error('Missing read_campaigns permission')
    }
    return gpAction(async (client) => client.emailOutreachAdmin.getPaused())
  }

const runDecision = async (
  call: () => Promise<void>,
  fallback: string
): Promise<EmailSendActionResult> => {
  try {
    const { has } = await auth()
    if (!has?.({ role: ADMIN_ROLE })) {
      throw new Error('Only admins can resume or cancel email sends')
    }
    await call()
  } catch (error) {
    return {
      error:
        error instanceof SdkError
          ? extractApiErrorMessage(error, fallback)
          : error instanceof Error
            ? error.message
            : fallback,
    }
  }
  revalidatePath('/dashboard/email-sends')
  return { error: null }
}

export const resumeEmailSend = async (
  id: number
): Promise<EmailSendActionResult> =>
  runDecision(
    () => gpAction(async (client) => client.emailOutreachAdmin.resume(id)),
    'Failed to resume send'
  )

export const cancelEmailSend = async (
  id: number
): Promise<EmailSendActionResult> =>
  runDecision(
    () => gpAction(async (client) => client.emailOutreachAdmin.cancel(id)),
    'Failed to cancel send'
  )
