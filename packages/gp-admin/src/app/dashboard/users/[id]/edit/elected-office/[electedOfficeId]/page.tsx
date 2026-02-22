import type { Metadata } from 'next'
import { getElectedOfficeOrNotFound } from '@/app/dashboard/elected-offices/getElectedOfficeOrNotFound'
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

  return (
    <EditElectedOfficeClient electedOffice={electedOffice} userId={userId} />
  )
}
