import type { Metadata } from 'next'
import { listElectedOffices } from '@/app/dashboard/elected-offices/actions'
import { ElectedOfficeListTable } from './components/ElectedOfficeListTable'
import { ViewLayout } from '../components/ViewLayout'
import { validateNumericParams } from '@/shared/util/validateNumericParams.util'
import { listOrEmpty } from '@/shared/util/gpClient.util'

export const metadata: Metadata = {
  title: 'Elected Offices | GP Admin',
  description: 'View elected offices',
}

interface ElectedOfficePageProps {
  params: Promise<{ id: string }>
}

export default async function ElectedOfficePage({
  params,
}: ElectedOfficePageProps) {
  const { id } = await params
  const [userId] = validateNumericParams(id)
  const { data: electedOffices } = await listOrEmpty(listElectedOffices(userId))

  return (
    <ViewLayout>
      <ElectedOfficeListTable
        electedOffices={electedOffices}
        basePath={`/dashboard/users/${userId}/elected-office`}
      />
    </ViewLayout>
  )
}
