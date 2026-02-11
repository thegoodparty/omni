import { Metadata } from 'next'
import { stubbedPathToVictory } from '@/data/stubbed-p2v'
import { P2VSection } from '../components/P2VSection'
import { ViewLayout } from '../components/ViewLayout'

export const metadata: Metadata = {
  title: 'Path to Victory | GP Admin',
  description: 'View path to victory details',
}

export default function P2VPage() {
  return (
    <ViewLayout>
      <P2VSection p2v={stubbedPathToVictory} />
    </ViewLayout>
  )
}
