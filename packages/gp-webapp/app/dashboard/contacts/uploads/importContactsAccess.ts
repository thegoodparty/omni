import { notFound } from 'next/navigation'
import { SERVE_IMPORT_CONTACTS_FLAG } from '@goodparty_org/contracts'
import { getFlagVariants } from '@shared/experiments/getFlagVariants'
import { serverRequest } from 'gpApi/server-request'
import { fetchUserCampaign } from 'app/onboarding/shared/getCampaign'
import candidateAccess from '../../shared/candidateAccess'

// The upload pages' gate, matching the Import contacts actions on the contacts
// page: the flag on, and for a Win campaign Pro, the same rule gp-api applies.
export const importContactsAccess = async (): Promise<{ isWin: boolean }> => {
  await candidateAccess()

  const variants = await getFlagVariants()
  if (variants?.[SERVE_IMPORT_CONTACTS_FLAG]?.value !== 'on') notFound()

  const electedOffice = await serverRequest(
    'GET /v1/elected-office/current',
    {},
    { ignoreResponseError: true },
  )
  if (electedOffice.ok && electedOffice.data) return { isWin: false }

  const campaign = await fetchUserCampaign()
  if (!campaign?.isPro) notFound()
  return { isWin: true }
}
