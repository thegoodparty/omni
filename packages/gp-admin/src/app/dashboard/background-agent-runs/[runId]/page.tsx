import { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { auth } from '@clerk/nextjs/server'
import { status } from '@poppanator/http-constants'
import { PERMISSIONS } from '@/lib/permissions'
import { SdkError } from '@/shared/gpApi'
import { gpAction } from '@/shared/util/gpClient.util'
import { BackgroundAgentRunDetailView } from './components/BackgroundAgentRunDetailView'

export const metadata: Metadata = {
  title: 'Agent Run | GP Admin',
  description: 'View an agent run, its artifact and its message transcript',
}

interface PageProps {
  params: Promise<{ runId: string }>
}

export default async function Page({ params }: PageProps) {
  const { has } = await auth()
  if (!has({ permission: PERMISSIONS.READ_AGENT_RUNS })) {
    notFound()
  }

  const { runId } = await params

  try {
    const detail = await gpAction((client) =>
      client.adminBackgroundAgentRuns.get(runId)
    )
    return <BackgroundAgentRunDetailView detail={detail} />
  } catch (error) {
    if (error instanceof SdkError && error.status === status.NotFound) {
      notFound()
    }
    throw error
  }
}
