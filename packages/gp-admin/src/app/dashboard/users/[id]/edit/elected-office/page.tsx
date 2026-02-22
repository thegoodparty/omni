import type { Metadata } from 'next'
import { listElectedOffices } from '@/app/dashboard/elected-offices/actions'
import { ElectedOfficeListTable } from '../../elected-office/components/ElectedOfficeListTable'
import { validateNumericParams } from '@/shared/util/validateNumericParams.util'

export const metadata: Metadata = {
  title: 'Edit Elected Office | GP Admin',
  description: 'Edit elected office details',
}

interface EditElectedOfficePageProps {
  params: Promise<{ id: string }>
}

export default async function EditElectedOfficePage({
  params,
}: EditElectedOfficePageProps) {
  const { id } = await params
  const [userId] = validateNumericParams(id)
  const { data: electedOffices } = await listElectedOffices(userId)

  return (
    <ElectedOfficeListTable
      electedOffices={electedOffices}
      basePath={`/dashboard/users/${userId}/edit/elected-office`}
    />
  )
}
