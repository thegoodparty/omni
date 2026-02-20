import { Metadata } from 'next'
import { getPathToVictoryOrNotFound } from '@/app/dashboard/p2v/getPathToVictoryOrNotFound'
import { EditP2VClient } from './EditP2VClient'
import { validateNumericParams } from '@/shared/util/validateNumericParams.util'

export const metadata: Metadata = {
  title: 'Edit Path to Victory | GP Admin',
  description: 'Edit path to victory details',
}

interface EditP2VDetailPageProps {
  params: Promise<{ id: string; p2vId: string }>
}

export default async function EditP2VDetailPage({
  params,
}: EditP2VDetailPageProps) {
  const { id, p2vId } = await params
  const [userId, p2vIdNum] = validateNumericParams(id, p2vId)

  const p2v = await getPathToVictoryOrNotFound(p2vIdNum)

  return <EditP2VClient p2v={p2v} userId={userId} />
}
