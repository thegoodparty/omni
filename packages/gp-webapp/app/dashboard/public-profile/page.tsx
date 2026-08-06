import type { JSX } from 'react'
import pageMetaData from 'helpers/metadataHelper'
import { serverRequest } from 'gpApi/server-request'
import type { Priority } from '@goodparty_org/contracts'
import DashboardLayout from '../shared/DashboardLayout'
import { NAV_LABELS } from '../shared/navLabels'
import PublicProfileEditor from './components/PublicProfileEditor'
import publicProfileAccess from './publicProfileAccess'
import type { GetMinePersonProfileResponse } from './shared/types'

const meta = pageMetaData({
  title: 'Public Profile | GoodParty.org',
  description:
    'Edit the public profile shown on your goodparty.org/people page.',
})
export const metadata = meta
export const dynamic = 'force-dynamic'

export default async function Page(): Promise<JSX.Element> {
  const product = await publicProfileAccess()

  // GET mine is authoritative for whether the person can publish yet (canCreate
  // is false until the data team mints their canonical personId). Priorities
  // feed the Serve "Top Priorities" publication picker and don't apply to Win.
  const [mineResp, prioritiesResp] = await Promise.all([
    serverRequest('GET /v1/person-profiles/mine', {}),
    product === 'serve'
      ? serverRequest('GET /v1/priorities', {}).catch(() => null)
      : Promise.resolve(null),
  ])

  const mine = mineResp.data as GetMinePersonProfileResponse
  const priorities = (prioritiesResp?.data ?? []) as Priority[]

  return (
    <DashboardLayout
      pathname="/dashboard/public-profile"
      showAlert={false}
      wrapperClassName="!p-0"
      // hasAction: the editor's publish toggle + Save changes portal into the
      // bar (PublicProfileEditor).
      navHeader={{
        icon: 'profile',
        label: NAV_LABELS.publicProfile,
        hasAction: true,
      }}
    >
      <PublicProfileEditor
        product={product}
        initialProfile={mine.profile}
        canCreate={mine.canCreate}
        priorities={priorities}
      />
    </DashboardLayout>
  )
}
