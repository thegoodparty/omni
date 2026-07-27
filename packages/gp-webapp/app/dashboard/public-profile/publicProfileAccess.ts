import { auth } from '@clerk/nextjs/server'
import { redirect } from 'next/navigation'
import { isRedirectError } from 'next/dist/client/components/redirect-error'
import { apiRoutes } from 'gpApi/routes'
import { serverFetch } from 'gpApi/serverFetch'

// Which product surface the caller edits their public profile from. The overlay
// and endpoints are identical; the product only changes copy and whether the
// Serve "Top Priorities" publication card is shown.
export type PublicProfileProduct = 'serve' | 'win'

const hasCurrentElectedOffice = async (): Promise<boolean> => {
  try {
    const resp = await serverFetch(apiRoutes.electedOffice.current)
    return Boolean(resp?.ok && resp?.data)
  } catch (e) {
    // Fail closed. Swallowing a transient error here (timeout, 500) and
    // returning false would fall through to hasCampaign and silently route an
    // elected official — who also has a campaign — into the Win product, i.e.
    // the wrong editor surface. Re-throwing (redirect or otherwise) surfaces an
    // error the official can retry instead of quietly editing the wrong profile.
    throw e
  }
}

const hasCampaign = async (): Promise<boolean> => {
  try {
    const resp = await serverFetch<{ status?: unknown }>(
      apiRoutes.campaign.status,
    )
    return Boolean(resp?.data?.status)
  } catch (e) {
    if (isRedirectError(e)) throw e
    return false
  }
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
