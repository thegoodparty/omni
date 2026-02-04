import { Metadata } from 'next'
import { stubbedPathToVictory } from '@/data/stubbed-p2v'
import { P2VSection } from '../../components/P2VSection'

export const metadata: Metadata = {
  title: 'Path to Victory | GP Admin',
  description: 'View path to victory details',
}

interface PageProps {
  params: Promise<{ id: string }>
}

export default async function P2VPage({ params }: PageProps) {
  const { id } = await params
  // TODO: Replace stubbed data with API call using id
  void id // Will be used when API is connected

  return <P2VSection p2v={stubbedPathToVictory} />
}
