import { Metadata } from 'next'
import { ProtectedContent } from '@/components/ProtectedContent'
import { PERMISSIONS } from '@/lib/permissions'
import AgentRunsPage from './components/AgentRunsPage'

export const metadata: Metadata = {
  title: 'Agent Runs | GP Admin',
  description: 'Browse and retry agent experiment runs',
}

export default function Page() {
  return (
    <ProtectedContent requiredPermission={PERMISSIONS.READ_AGENT_RUNS}>
      <AgentRunsPage />
    </ProtectedContent>
  )
}
