import type { Metadata } from 'next'
import { Box } from '@radix-ui/themes'
import { getElectedOfficeOrNotFound } from '@/app/dashboard/elected-offices/getElectedOfficeOrNotFound'
import { getOrganization } from '@/app/dashboard/organizations/actions'
import { ElectedOfficeDisplaySection } from '../../components/ElectedOfficeDisplaySection'
import { ViewLayout } from '../../components/ViewLayout'
import { validateNumericParams } from '@/shared/util/validateNumericParams.util'
import { AgentJobsPanel } from './components/AgentJobsPanel'

export const metadata: Metadata = {
  title: 'Elected Office Detail | GP Admin',
  description: 'View elected office detail',
}

interface ElectedOfficeDetailPageProps {
  params: Promise<{ id: string; electedOfficeId: string }>
}

export default async function ElectedOfficeDetailPage({
  params,
}: ElectedOfficeDetailPageProps) {
  const { id, electedOfficeId } = await params
  validateNumericParams(id)

  const electedOffice = await getElectedOfficeOrNotFound(electedOfficeId)
  const organization = await getOrganization(`eo-${electedOffice.id}`)

  return (
    <ViewLayout>
      <ElectedOfficeDisplaySection
        electedOffice={electedOffice}
        district={organization?.district ?? null}
        positionName={organization?.positionName ?? null}
      />
      <Box mt="4">
        <AgentJobsPanel
          electedOfficeId={electedOffice.id}
          organizationSlug={electedOffice.organizationSlug}
        />
      </Box>
    </ViewLayout>
  )
}
