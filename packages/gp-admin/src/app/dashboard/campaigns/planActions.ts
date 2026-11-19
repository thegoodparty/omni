'use server'

import { auth } from '@clerk/nextjs/server'
import { revalidatePath } from 'next/cache'
import { PERMISSIONS } from '@/lib/permissions'
import { gpAction } from '@/shared/util/gpClient.util'
import { extractApiErrorMessage } from '@/lib/utils/sdkError'
import type {
  AdminExtendPlan,
  AdminRefundPlanResponse,
  AdminSetPlan,
  CampaignPlanState,
} from '@/shared/gpApi'

export type PlanActionResult<T> =
  | { data: T; error: null }
  | { data: null; error: string }

// Returned, not thrown: Next redacts a thrown server-action error in prod, and
// gp-api's 409 ("Cancel the Stripe subscription first") is what staff need to read.
const runPlanAction = async <T>(
  userId: number,
  fallback: string,
  call: Parameters<typeof gpAction<T>>[0]
): Promise<PlanActionResult<T>> => {
  const { has } = await auth()
  if (!has?.({ permission: PERMISSIONS.WRITE_CAMPAIGNS })) {
    return { data: null, error: 'Missing write_campaigns permission' }
  }
  try {
    const data = await gpAction(call)
    revalidatePath(`/dashboard/users/${userId}`, 'layout')
    return { data, error: null }
  } catch (error) {
    return { data: null, error: extractApiErrorMessage(error, fallback) }
  }
}

export const setCampaignPlan = (
  campaignId: number,
  userId: number,
  input: AdminSetPlan
): Promise<PlanActionResult<CampaignPlanState>> =>
  runPlanAction(userId, "Couldn't change the plan", (client) =>
    client.campaigns.setPlan(campaignId, input)
  )

export const extendCampaignPlan = (
  campaignId: number,
  userId: number,
  input: AdminExtendPlan
): Promise<PlanActionResult<CampaignPlanState>> =>
  runPlanAction(userId, "Couldn't change the end date", (client) =>
    client.campaigns.extendPlan(campaignId, input)
  )

export const refundCampaignPlan = (
  campaignId: number,
  userId: number
): Promise<PlanActionResult<AdminRefundPlanResponse>> =>
  runPlanAction(userId, "Couldn't refund the plan", (client) =>
    client.campaigns.refundPlan(campaignId)
  )
