import { Metadata } from 'next'
import { listPathsToVictory } from '@/app/dashboard/p2v/actions'
import { P2VListTable } from './components/P2VListTable'
import { ViewLayout } from '../components/ViewLayout'
import { validateNumericParams } from '@/shared/util/validateNumericParams.util'

export const metadata: Metadata = {
  title: 'Paths to Victory | GP Admin',
  description: 'View paths to victory',
}

interface P2VPageProps {
  params: Promise<{ id: string }>
}

export default async function P2VPage({ params }: P2VPageProps) {
  const { id } = await params
  const [userId] = validateNumericParams(id)
  const { data: pathsToVictory } = await listPathsToVictory(userId)

  return (
    <ViewLayout>
      <P2VListTable
        pathsToVictory={pathsToVictory}
        basePath={`/dashboard/users/${userId}/p2v`}
      />
    </ViewLayout>
  )
}
