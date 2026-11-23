'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button, Flex, Text } from '@radix-ui/themes'
import { HiRefresh, HiTrash } from 'react-icons/hi'
import type {
  JobDeadLetter,
  JobDeadLetterBatchFailure,
} from '@goodparty_org/contracts'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { useToast } from '@/components/Toast'
import { describeActionFailure } from '@/shared/util/actionFailure.util'
import { deleteJobDeadLetters, redriveJobDeadLetters } from '../actions'

type BatchAction = 'redrive' | 'delete'

interface JobDeadLetterSelectionBarProps {
  selected: JobDeadLetter[]
  onDone: () => void
}

// The batch routes handle each entry on its own, so a select-all that spans
// dead letters which cannot be re-driven still does the work it can and
// reports the rest. The dialog says that up front instead of the bar
// refusing the whole selection over a few entries.
export function JobDeadLetterSelectionBar({
  selected,
  onDone,
}: JobDeadLetterSelectionBarProps) {
  const router = useRouter()
  const { showToast } = useToast()
  const [action, setAction] = useState<BatchAction | null>(null)
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)

  const ids = selected.map((deadLetter) => deadLetter.id)
  const withoutSource = selected.filter(
    (deadLetter) => !deadLetter.sourceQueue
  ).length

  const handleConfirm = async () => {
    setBusy(true)
    setFailure(null)
    const result = await (
      action === 'delete'
        ? deleteJobDeadLetters(ids)
        : redriveJobDeadLetters(ids)
    ).catch((error) => ({
      error: describeActionFailure(
        error,
        action === 'delete'
          ? 'Failed to delete the selected dead letters'
          : 'Failed to re-drive the selected jobs'
      ),
    }))
    setBusy(false)

    if ('error' in result) {
      setFailure(result.error)
      return
    }

    const failures: JobDeadLetterBatchFailure[] = result.failed
    const succeeded =
      'deleted' in result ? result.deleted.length : result.redriven.length
    setAction(null)
    onDone()
    router.refresh()

    const done = action === 'delete' ? 'Deleted' : 'Re-drove'
    if (failures.length === 0) {
      showToast(`${done} ${succeeded} of ${succeeded}`)
      return
    }
    showToast(
      `${done} ${succeeded} of ${ids.length}. ${failures.length} left in place.`,
      'error'
    )
  }

  return (
    <>
      <Flex
        align="center"
        justify="between"
        gap="3"
        px="4"
        py="2"
        className="rounded-lg bg-[var(--accent-3)]"
      >
        <Text size="2" weight="medium">
          {ids.length} selected
        </Text>
        <Flex gap="2">
          <Button
            size="1"
            variant="soft"
            onClick={() => {
              setFailure(null)
              setAction('redrive')
            }}
          >
            <HiRefresh className="w-4 h-4" />
            Re-drive {ids.length}
          </Button>
          <Button
            size="1"
            variant="soft"
            color="red"
            onClick={() => {
              setFailure(null)
              setAction('delete')
            }}
          >
            <HiTrash className="w-4 h-4" />
            Delete {ids.length}
          </Button>
        </Flex>
      </Flex>
      <ConfirmDialog
        open={action !== null}
        onOpenChange={(next) => {
          if (busy) return
          if (!next) setAction(null)
          setFailure(null)
        }}
        onConfirm={handleConfirm}
        title={
          action === 'delete'
            ? `Delete ${ids.length} dead letters?`
            : `Re-drive ${ids.length} dead letters?`
        }
        description={
          <>
            {action === 'delete'
              ? `This drops all ${ids.length} from their dead letter queues for good, so they can never be re-driven or read again.`
              : `Each job goes back on the queue its own dead letter recorded, with its attempts reset. Anything a job already did before it failed runs again, so fix the cause first.`}
            {action !== 'delete' && withoutSource > 0 && (
              <span className="mt-2 block">
                {withoutSource === 1
                  ? 'One selected dead letter records no source queue, so it stays put.'
                  : `${withoutSource} selected dead letters record no source queue, so they stay put.`}
              </span>
            )}
            {failure && (
              <span className="mt-2 block text-[var(--red-11)]">{failure}</span>
            )}
          </>
        }
        confirmLabel={action === 'delete' ? 'Delete' : 'Re-drive'}
        cancelLabel="Cancel"
        color={action === 'delete' ? 'red' : 'blue'}
        loading={busy}
      />
    </>
  )
}
