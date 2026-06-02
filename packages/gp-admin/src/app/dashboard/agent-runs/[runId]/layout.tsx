import { auth } from '@clerk/nextjs/server'
import { notFound } from 'next/navigation'
import { SdkError } from '@goodparty_org/sdk'
import { status } from '@poppanator/http-constants'
import { PERMISSIONS } from '@/lib/permissions'
import { gpAction } from '@/shared/util/gpClient.util'
import { AgentRunProvider } from './context/AgentRunContext'

interface AgentRunLayoutProps {
  children: React.ReactNode
  params: Promise<{ runId: string }>
}

export default async function AgentRunLayout({
  children,
  params,
}: AgentRunLayoutProps) {
  const { has } = await auth()
  if (!has({ permission: PERMISSIONS.READ_AGENT_RUNS })) {
    notFound()
  }

  const { runId } = await params

  let detail
  try {
    detail = await gpAction((client) => client.adminAgentRuns.get(runId))
  } catch (error) {
    if (error instanceof SdkError && error.status === status.NotFound) {
      notFound()
    }
    throw error
  }

  return <AgentRunProvider detail={detail}>{children}</AgentRunProvider>
}
