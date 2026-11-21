'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@radix-ui/themes'
import { HiRefresh } from 'react-icons/hi'
import type { JobDeadLetter } from '@goodparty_org/contracts'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { useToast } from '@/components/Toast'
import { describeActionFailure } from '@/shared/util/actionFailure.util'
import { redriveJobDeadLetter } from '../actions'

interface RedriveDeadLetterButtonProps {
  deadLetter: Pick<JobDeadLetter, 'id' | 'sourceQueue'>
  // A dead letter with no recorded source queue has nowhere to go, so the
  // button is offered disabled with the reason instead of failing on click.
  size?: '1' | '2'
}

export function RedriveDeadLetterButton({
  deadLetter,
  size = '1',
}: RedriveDeadLetterButtonProps) {
  const router = useRouter()
  const { showToast } = useToast()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)
  const { sourceQueue } = deadLetter

  const handleConfirm = async () => {
    setBusy(true)
    setFailure(null)
    const result = await redriveJobDeadLetter(deadLetter.id).catch((error) => ({
      error: describeActionFailure(error, 'Failed to redrive the job'),
    }))
    setBusy(false)
    if (result.error) {
      setFailure(result.error)
      return
    }
    setOpen(false)
    showToast('Job put back on its queue')
    router.push('/dashboard/job-dead-letters')
    router.refresh()
  }

  return (
    <>
      <Button
        size={size}
        variant="outline"
        disabled={!sourceQueue}
        title={
          sourceQueue
            ? undefined
            : 'This dead letter records no source queue, so it cannot be redriven'
        }
        onClick={() => setOpen(true)}
      >
        <HiRefresh className="w-4 h-4" />
        Re-drive
      </Button>
      <ConfirmDialog
        open={open}
        onOpenChange={(next) => {
          if (busy) return
          setOpen(next)
          setFailure(null)
        }}
        onConfirm={handleConfirm}
        title="Re-drive this job?"
        description={
          <>
            This puts the job from {sourceQueue ?? 'its queue'} back as a new
            job with its attempts reset. Anything it already did before it
            failed runs again, so fix the cause first.
            {failure && (
              <span className="mt-2 block text-[var(--red-11)]">{failure}</span>
            )}
          </>
        }
        confirmLabel="Re-drive"
        cancelLabel="Keep it dead"
        color="blue"
        loading={busy}
      />
    </>
  )
}
