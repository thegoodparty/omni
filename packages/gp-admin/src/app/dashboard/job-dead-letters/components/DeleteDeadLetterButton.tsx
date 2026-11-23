'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@radix-ui/themes'
import { HiTrash } from 'react-icons/hi'
import type { JobDeadLetter } from '@goodparty_org/contracts'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { useToast } from '@/components/Toast'
import { describeActionFailure } from '@/shared/util/actionFailure.util'
import { deleteJobDeadLetter } from '../actions'

interface DeleteDeadLetterButtonProps {
  deadLetter: Pick<JobDeadLetter, 'id' | 'sourceQueue'>
  size?: '1' | '2'
}

export function DeleteDeadLetterButton({
  deadLetter,
  size = '1',
}: DeleteDeadLetterButtonProps) {
  const router = useRouter()
  const { showToast } = useToast()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)
  const { sourceQueue } = deadLetter

  const handleConfirm = async () => {
    setBusy(true)
    setFailure(null)
    const result = await deleteJobDeadLetter(deadLetter.id).catch((error) => ({
      error: describeActionFailure(error, 'Failed to delete the dead letter'),
    }))
    setBusy(false)
    if (result.error) {
      setFailure(result.error)
      return
    }
    setOpen(false)
    showToast('Dead letter deleted')
    router.push('/dashboard/job-dead-letters')
    router.refresh()
  }

  return (
    <>
      <Button
        size={size}
        variant="outline"
        color="red"
        className="whitespace-nowrap"
        onClick={() => setOpen(true)}
      >
        <HiTrash className="w-4 h-4" />
        Delete
      </Button>
      <ConfirmDialog
        open={open}
        onOpenChange={(next) => {
          if (busy) return
          setOpen(next)
          setFailure(null)
        }}
        onConfirm={handleConfirm}
        title="Delete this dead letter?"
        description={
          <>
            This drops the job from {sourceQueue ?? 'its dead letter queue'} for
            good, so it can never be re-driven or read again. Nothing it did
            before it failed is undone.
            {failure && (
              <span className="mt-2 block text-[var(--red-11)]">{failure}</span>
            )}
          </>
        }
        confirmLabel="Delete"
        cancelLabel="Keep it"
        color="red"
        loading={busy}
      />
    </>
  )
}
