import { Metadata } from 'next'
import { ProtectedContent } from '@/components/ProtectedContent'
import { PERMISSIONS } from '@/lib/permissions'
import { BackgroundAgentRunsPage } from './components/BackgroundAgentRunsPage'

export const metadata: Metadata = {
  title: 'Agent Run | GP Admin',
  description: 'Browse the runs of gp-api background agents',
}

export default function Page() {
  return (
    <ProtectedContent requiredPermission={PERMISSIONS.READ_AGENT_RUNS}>
      <BackgroundAgentRunsPage />
    </ProtectedContent>
  )
}
