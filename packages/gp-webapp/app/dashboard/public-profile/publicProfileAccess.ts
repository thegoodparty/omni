import { auth } from '@clerk/nextjs/server'
import { redirect } from 'next/navigation'
import { apiRoutes } from 'gpApi/routes'
import { serverFetch } from 'gpApi/serverFetch'

// Which product surface the caller edits their public profile from. The overlay
// and endpoints are identical; the product only changes copy and whether the
// Serve "Top Priorities" publication card is shown.
export type PublicProfileProduct = 'serve' | 'win'

// Both checks fail closed: serverFetch returns { ok: false } for HTTP 4xx/5xx
// (correctly mapped to false below), so the only way these throw is a genuine
// transient error (timeout, DNS, connection reset) or a Next redirect. In every
// one of those cases we let it propagate rather than swallowing it and returning
// false — swallowing would mis-route an elected official (who also has a
// campaign) into Win, or bounce a valid candidate to /dashboard, on a blip the
// user could otherwise just retry.
const hasCurrentElectedOffice = async (): Promise<boolean> => {
  const resp = await serverFetch(apiRoutes.electedOffice.current)
  return Boolean(resp?.ok && resp?.data)
}

const hasCampaign = async (): Promise<boolean> => {
  const resp = await serverFetch<{ status?: unknown }>(
    apiRoutes.campaign.status,
  )
  return Boolean(resp?.data?.status)
}

// Gate the public-profile editor: elected officials edit via Serve, candidates
// via Win. Anyone with neither is bounced to the dashboard home.
export default async function publicProfileAccess(): Promise<PublicProfileProduct> {
  const { userId } = await auth()
  if (!userId) {
    return redirect('/sign-up')
  }

  if (await hasCurrentElectedOffice()) {
    return 'serve'
  }
  if (await hasCampaign()) {
    return 'win'
  }

  return redirect('/dashboard')
}
