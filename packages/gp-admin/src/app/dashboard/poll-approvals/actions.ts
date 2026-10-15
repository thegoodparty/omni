'use server'

import { auth, currentUser } from '@clerk/nextjs/server'
import { revalidatePath } from 'next/cache'
import { SdkError } from '@goodparty_org/sdk'
import type { PollQueueItem, PollReviewDetail } from '@goodparty_org/contracts'
import { PERMISSIONS } from '@/lib/permissions'
import { extractApiErrorMessage } from '@/lib/utils/sdkError'
import { gpAction } from '@/shared/util/gpClient.util'
import type { PollActionResult } from './types'

const ADMIN_ROLE = 'org:admin'

// Deciding and editing are org:admin only, as in the SMS console. The queue
// itself is visible to anyone who can read campaigns.
async function requireApprover() {
  const { has } = await auth()
  if (!has?.({ role: ADMIN_ROLE })) {
    throw new Error('Only admins can decide polls')
  }
  const user = await currentUser()
  const email =
    user?.primaryEmailAddress?.emailAddress ??
    user?.emailAddresses[0]?.emailAddress
  if (!email) {
    throw new Error('Could not resolve your admin identity')
  }
  return { email }
}

const requireReader = async () => {
  const { has } = await auth()
  if (!has?.({ permission: PERMISSIONS.READ_CAMPAIGNS })) {
    throw new Error('Missing read_campaigns permission')
  }
}

export const getPollQueue = async (): Promise<PollQueueItem[]> => {
  await requireReader()
  const responses = await gpAction(async (client) =>
    Promise.all(
      (
        ['awaiting_review', 'approved', 'sent', 'denied', 'canceled'] as const
      ).map((status) => client.pollOutreachAdmin.getQueue(status))
    )
  )
  return responses.flatMap(({ items }) => items)
}

export const getPollDetail = async (id: number): Promise<PollReviewDetail> => {
  await requireReader()
  return gpAction(async (client) => client.pollOutreachAdmin.getDetail(id))
}

// Mutations return the failure instead of throwing: a thrown message is
// redacted in prod, and the 409 text (a second approver lost the race) is
// exactly what the staff member needs to read.
const toResult = (error: unknown, fallback: string): PollActionResult => ({
  error:
    error instanceof SdkError
      ? extractApiErrorMessage(error, fallback)
      : error instanceof Error
        ? error.message
        : fallback,
})

const revalidate = (id: number) => {
  revalidatePath('/dashboard/poll-approvals')
  revalidatePath(`/dashboard/poll-approvals/${id}`)
}

export const approvePoll = async (
  id: number,
  expansionId?: string
): Promise<PollActionResult> => {
  const { email } = await requireApprover()
  try {
    await gpAction(async (client) =>
      client.pollOutreachAdmin.approve(id, { approvedBy: email, expansionId })
    )
    revalidate(id)
    return { error: null }
  } catch (error) {
    return toResult(error, 'Failed to approve poll')
  }
}

export const denyPoll = async (
  id: number,
  reason: string
): Promise<PollActionResult> => {
  const { email } = await requireApprover()
  try {
    await gpAction(async (client) =>
      client.pollOutreachAdmin.deny(id, { deniedBy: email, reason })
    )
    revalidate(id)
    return { error: null }
  } catch (error) {
    return toResult(error, 'Failed to deny poll')
  }
}

export const editPollQuestion = async (
  id: number,
  question: string
): Promise<PollActionResult> => {
  const { email } = await requireApprover()
  try {
    await gpAction(async (client) =>
      client.pollOutreachAdmin.edit(id, { question, editedBy: email })
    )
    revalidate(id)
    return { error: null }
  } catch (error) {
    return toResult(error, 'Failed to edit question')
  }
}
