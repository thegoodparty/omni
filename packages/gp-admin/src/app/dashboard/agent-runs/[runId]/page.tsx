import { Metadata } from 'next'
import { AgentRunDetailView } from './components/AgentRunDetailView'

export const metadata: Metadata = {
  title: 'Agent Run Detail | GP Admin',
  description: 'View an agent run, its artifact, and conversation log',
}

export default function Page() {
  return <AgentRunDetailView />
}
