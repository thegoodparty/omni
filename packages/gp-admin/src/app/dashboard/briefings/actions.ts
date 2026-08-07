'use server'

import { auth, currentUser } from '@clerk/nextjs/server'
import { PERMISSIONS } from '@/lib/permissions'
import { gpAction } from '@/shared/util/gpClient.util'
import {
  GP_ENVIRONMENT,
  resolveEnvironment,
  type GpEnvironment,
} from '@/shared/util/gpEnvironment'
import type {
  BriefingAdminRow,
  ListBriefingsParams,
  ListBriefingsResult,
} from './types'

function getWebappUrl(env: GpEnvironment): string {
  const urls: Record<GpEnvironment, string | undefined> = {
    [GP_ENVIRONMENT.DEV]: process.env.NEXT_PUBLIC_GP_DEV_WEBAPP_URL,
    [GP_ENVIRONMENT.PROD]: process.env.NEXT_PUBLIC_GP_WEBAPP_URL,
  }
  const url = urls[env]
  if (!url) throw new Error(`Webapp URL not configured for environment: ${env}`)
  return url
}

export const listBriefings = async (
  params: ListBriefingsParams
): Promise<ListBriefingsResult> => {
  const { has } = await auth()
  if (!has({ permission: PERMISSIONS.REVIEW_BRIEFINGS })) {
    throw new Error('Missing review_briefings permission')
  }
  return gpAction((client) => client.admin.briefings.list(params))
}

export const startBriefingReview = async (
  briefingId: string
): Promise<{ url: string }> => {
  const { orgId, has } = await auth()
  const user = await currentUser()

  if (!user || !orgId) throw new Error('Not authenticated')
  if (!has({ permission: PERMISSIONS.REVIEW_BRIEFINGS })) {
    throw new Error('Missing review_briefings permission')
  }
  if (!has({ permission: PERMISSIONS.IMPERSONATE_USERS })) {
    throw new Error('Missing impersonate permission')
  }

  const actorEmail = user.primaryEmailAddress?.emailAddress
  if (!actorEmail) throw new Error('Could not determine actor email')

  const env = resolveEnvironment(orgId)
  const webappUrl = getWebappUrl(env)

  const briefing: BriefingAdminRow = await gpAction((client) =>
    client.admin.briefings.get(briefingId)
  )

  const { token } = await gpAction((client) =>
    client.admin.impersonateUser(briefing.user.id, actorEmail)
  )

  const url = `${webappUrl}/impersonate?__clerk_ticket=${encodeURIComponent(
    token
  )}&returnTo=${encodeURIComponent(
    '/dashboard/admin-review/briefings/' + briefing.meetingDate
  )}&adminReturnTo=${encodeURIComponent('/dashboard/briefings')}`

  return { url }
}
