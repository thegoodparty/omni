'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@radix-ui/themes'
import { HiRefresh } from 'react-icons/hi'
import { ProtectedContent } from '@/components/ProtectedContent'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { useToast } from '@/components/Toast'
import { PERMISSIONS } from '@/lib/permissions'
import { retryAgentRun } from '../../actions'

interface RetryRunButtonProps {
  runId: string
}

export function RetryRunButton({ runId }: RetryRunButtonProps) {
  const router = useRouter()
  const { showToast } = useToast()
  const [loading, setLoading] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)

  async function handleRetry() {
    setLoading(true)
    try {
      const newRunId = await retryAgentRun(runId)
      setConfirmOpen(false)
      router.push(`/dashboard/agent-runs/${newRunId}`)
    } catch (error) {
      setLoading(false)
      showToast(error instanceof Error ? error.message : 'Failed to retry run')
    }
  }

  return (
    <ProtectedContent
      requiredPermission={PERMISSIONS.WRITE_AGENT_RUNS}
      hideWhenUnauthorized
    >
      <Button variant="outline" onClick={() => setConfirmOpen(true)}>
        <HiRefresh className="w-4 h-4" />
        Retry
      </Button>
      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        onConfirm={handleRetry}
        title="Retry agent run"
        description="Re-dispatch this run with the same params?"
        confirmLabel="Retry"
        color="blue"
        loading={loading}
      />
    </ProtectedContent>
  )
}
