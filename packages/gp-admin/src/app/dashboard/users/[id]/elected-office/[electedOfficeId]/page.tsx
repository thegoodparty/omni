import type { Metadata } from 'next'
import { getElectedOfficeOrNotFound } from '@/app/dashboard/elected-offices/getElectedOfficeOrNotFound'
import { ElectedOfficeDisplaySection } from '../../components/ElectedOfficeDisplaySection'
import { ViewLayout } from '../../components/ViewLayout'
import { validateNumericParams } from '@/shared/util/validateNumericParams.util'

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

  return (
    <ViewLayout>
      <ElectedOfficeDisplaySection electedOffice={electedOffice} />
    </ViewLayout>
  )
}
