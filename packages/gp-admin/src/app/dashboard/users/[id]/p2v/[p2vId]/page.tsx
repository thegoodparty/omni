import { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { getPathToVictoryOrNotFound } from '@/app/dashboard/p2v/getPathToVictoryOrNotFound'
import { P2VSection } from '../../components/P2VSection'
import { ViewLayout } from '../../components/ViewLayout'

export const metadata: Metadata = {
  title: 'Path to Victory Detail | GP Admin',
  description: 'View path to victory detail',
}

interface P2VDetailPageProps {
  params: Promise<{ id: string; p2vId: string }>
}

export default async function P2VDetailPage({ params }: P2VDetailPageProps) {
  const { id, p2vId } = await params
  const userId = Number(id)
  const p2vIdNum = Number(p2vId)
  if (Number.isNaN(userId) || Number.isNaN(p2vIdNum)) {
    notFound()
  }

  const p2v = await getPathToVictoryOrNotFound(p2vIdNum)

  return (
    <ViewLayout>
      <P2VSection p2v={p2v} />
    </ViewLayout>
  )
}
