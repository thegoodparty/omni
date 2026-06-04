import type { Metadata } from 'next'
import { getElectedOfficeOrNotFound } from '@/app/dashboard/elected-offices/getElectedOfficeOrNotFound'
import { getCampaign } from '@/app/dashboard/campaigns/actions'
import { getOrganization } from '@/app/dashboard/organizations/actions'
import { EditElectedOfficeClient } from './EditElectedOfficeClient'
import { validateNumericParams } from '@/shared/util/validateNumericParams.util'

export const metadata: Metadata = {
  title: 'Edit Elected Office | GP Admin',
  description: 'Edit elected office details',
}

interface EditElectedOfficeDetailPageProps {
  params: Promise<{ id: string; electedOfficeId: string }>
}

export default async function EditElectedOfficeDetailPage({
  params,
}: EditElectedOfficeDetailPageProps) {
  const { id, electedOfficeId } = await params
  const [userId] = validateNumericParams(id)

  const electedOffice = await getElectedOfficeOrNotFound(electedOfficeId)

  const [organization, relatedCampaign] = await Promise.all([
    getOrganization(`eo-${electedOffice.id}`),
    electedOffice.campaignId
      ? getCampaign(electedOffice.campaignId).catch(() => null)
      : Promise.resolve(null),
  ])

  const state = relatedCampaign?.details?.state ?? ''
  const electionYear = relatedCampaign?.details?.electionDate
    ? Number(relatedCampaign.details.electionDate.split('-')[0])
    : 0

  return (
    <EditElectedOfficeClient
      electedOffice={electedOffice}
      userId={userId}
      state={state}
      electionYear={electionYear}
      initialDistrictType={organization?.district?.l2Type}
      initialDistrictName={organization?.district?.l2Name}
    />
  )
}
