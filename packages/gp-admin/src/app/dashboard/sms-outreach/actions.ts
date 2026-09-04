'use server'

import { auth, currentUser } from '@clerk/nextjs/server'
import { revalidatePath } from 'next/cache'
import { PERMISSIONS } from '@/lib/permissions'
import { gpAction } from '@/shared/util/gpClient.util'
import type {
  SmsAdminDetailResponse,
  SmsApprovalQueueItem,
  SmsApprovalQueueResponse,
} from '@goodparty_org/contracts'

const ADMIN_ROLE = 'org:admin'

// Approve/deny are decision actions: org:admin only (product decision
// 2026-09-01). The queue itself is visible to anyone who can read campaigns.
async function requireApprover() {
  const { has } = await auth()
  if (!has?.({ role: ADMIN_ROLE })) {
    throw new Error('Only admins can decide SMS campaigns')
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

export const getSmsQueue = async (): Promise<SmsApprovalQueueResponse> => {
  const { has } = await auth()
  if (!has?.({ permission: PERMISSIONS.READ_CAMPAIGNS })) {
    throw new Error('Missing read_campaigns permission')
  }
  return gpAction(async (client) => client.smsOutreachAdmin.getQueue())
}

export const getSmsDetail = async (
  id: number
): Promise<SmsAdminDetailResponse> => {
  const { has } = await auth()
  if (!has?.({ permission: PERMISSIONS.READ_CAMPAIGNS })) {
    throw new Error('Missing read_campaigns permission')
  }
  return gpAction(async (client) => client.smsOutreachAdmin.getDetail(id))
}

export const approveSms = async (id: number): Promise<SmsApprovalQueueItem> => {
  const { email } = await requireApprover()
  const item = await gpAction(async (client) =>
    client.smsOutreachAdmin.approve(id, { approvedBy: email })
  )
  revalidatePath('/dashboard/sms-outreach')
  revalidatePath(`/dashboard/sms-outreach/${id}`)
  return item
}

export const denySms = async (
  id: number,
  reason: string
): Promise<SmsApprovalQueueItem> => {
  const { email } = await requireApprover()
  const item = await gpAction(async (client) =>
    client.smsOutreachAdmin.deny(id, { deniedBy: email, reason })
  )
  revalidatePath('/dashboard/sms-outreach')
  revalidatePath(`/dashboard/sms-outreach/${id}`)
  return item
}

export const cancelSms = async (id: number): Promise<SmsApprovalQueueItem> => {
  const { email } = await requireApprover()
  const item = await gpAction(async (client) =>
    client.smsOutreachAdmin.cancel(id, { canceledBy: email })
  )
  revalidatePath('/dashboard/sms-outreach')
  revalidatePath(`/dashboard/sms-outreach/${id}`)
  return item
}

// The usual fix path: staff correct the message, then approve. Editing is
// as consequential as deciding (the text sends under the candidate's
// name), so it carries the same org:admin gate.
export const editSms = async (
  id: number,
  script: string
): Promise<SmsApprovalQueueItem> => {
  const { email } = await requireApprover()
  const item = await gpAction(async (client) =>
    client.smsOutreachAdmin.edit(id, { script, editedBy: email })
  )
  revalidatePath('/dashboard/sms-outreach')
  revalidatePath(`/dashboard/sms-outreach/${id}`)
  return item
}
