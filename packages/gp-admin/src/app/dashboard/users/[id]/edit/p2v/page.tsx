import { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { listPathsToVictory } from '@/app/dashboard/p2v/actions'
import { P2VListTable } from '../../p2v/components/P2VListTable'

export const metadata: Metadata = {
  title: 'Edit Path to Victory | GP Admin',
  description: 'Edit path to victory details',
}

interface EditP2VPageProps {
  params: Promise<{ id: string }>
}

export default async function EditP2VPage({ params }: EditP2VPageProps) {
  const { id } = await params
  const userId = Number(id)
  if (Number.isNaN(userId)) {
    notFound()
  }
  const { data: pathsToVictory } = await listPathsToVictory(userId)

  return (
    <P2VListTable
      pathsToVictory={pathsToVictory}
      basePath={`/dashboard/users/${userId}/edit/p2v`}
    />
  )
}
