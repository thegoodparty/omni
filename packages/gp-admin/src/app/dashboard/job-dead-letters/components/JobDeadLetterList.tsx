'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Button, Checkbox, Flex, Table, Text } from '@radix-ui/themes'
import { HiRefresh, HiTrash } from 'react-icons/hi'
import type { JobDeadLetter } from '@goodparty_org/contracts'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { useToast } from '@/components/Toast'
import { formatDateTime } from '@/lib/utils/date'
import { describeActionFailure } from '@/shared/util/actionFailure.util'
import { deleteJobDeadLetters, redriveJobDeadLetters } from '../actions'
import { DeleteDeadLetterButton } from './DeleteDeadLetterButton'
import { RedriveDeadLetterButton } from './RedriveDeadLetterButton'

interface JobDeadLetterListProps {
  deadLetters: JobDeadLetter[]
}

const shortId = (id: string): string =>
  id.length > 10 ? `${id.slice(0, 4)}…${id.slice(-5)}` : id

export function JobDeadLetterList({ deadLetters }: JobDeadLetterListProps) {
  const router = useRouter()
  const { showToast } = useToast()
  const [selected, setSelected] = useState<string[]>([])
  const [pending, setPending] = useState<'redrive' | 'delete' | null>(null)
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)

  if (deadLetters.length === 0) {
    return (
      <Text color="gray" size="3">
        No dead letters right now.
      </Text>
    )
  }

  const visibleSelected = deadLetters
    .filter((deadLetter) => selected.includes(deadLetter.id))
    .map((deadLetter) => deadLetter.id)
  const redrivable = deadLetters.filter(
    (deadLetter) => selected.includes(deadLetter.id) && deadLetter.sourceQueue
  )
  const allSelected = visibleSelected.length === deadLetters.length
  const someSelected = visibleSelected.length > 0 && !allSelected

  const toggle = (id: string, checked: boolean) =>
    setSelected((current) =>
      checked ? [...current, id] : current.filter((value) => value !== id)
    )

  const handleConfirm = async () => {
    if (!pending) return
    const redrive = pending === 'redrive'
    const ids = redrive
      ? redrivable.map((deadLetter) => deadLetter.id)
      : visibleSelected
    setBusy(true)
    setFailure(null)
    const result = await (
      redrive ? redriveJobDeadLetters : deleteJobDeadLetters
    )(ids).catch((error) => ({
      done: 0,
      error: describeActionFailure(
        error,
        redrive ? 'Failed to redrive the jobs' : 'Failed to delete the jobs'
      ),
    }))
    setBusy(false)
    if (result.error) {
      setFailure(
        `${result.done} of ${ids.length} done before it stopped: ${result.error}`
      )
      if (result.done > 0) router.refresh()
      return
    }
    setPending(null)
    setSelected([])
    showToast(
      redrive
        ? `${result.done} jobs put back on their queues`
        : `${result.done} dead letters deleted`
    )
    router.refresh()
  }

  return (
    <>
      {visibleSelected.length > 0 && (
        <Flex align="center" gap="3" mb="3">
          <Text size="2" weight="medium">
            {visibleSelected.length} selected
          </Text>
          <Button
            size="1"
            variant="outline"
            className="whitespace-nowrap"
            disabled={redrivable.length === 0}
            onClick={() => setPending('redrive')}
          >
            <HiRefresh className="w-4 h-4" />
            Re-drive
          </Button>
          <Button
            size="1"
            variant="outline"
            color="red"
            className="whitespace-nowrap"
            onClick={() => setPending('delete')}
          >
            <HiTrash className="w-4 h-4" />
            Delete
          </Button>
        </Flex>
      )}
      <Table.Root>
        <Table.Header>
          <Table.Row>
            <Table.ColumnHeaderCell>
              <Checkbox
                aria-label="Select all"
                checked={
                  allSelected ? true : someSelected ? 'indeterminate' : false
                }
                onCheckedChange={(checked) =>
                  setSelected(
                    checked === true
                      ? deadLetters.map((deadLetter) => deadLetter.id)
                      : []
                  )
                }
              />
            </Table.ColumnHeaderCell>
            <Table.ColumnHeaderCell>ID</Table.ColumnHeaderCell>
            <Table.ColumnHeaderCell>Died</Table.ColumnHeaderCell>
            <Table.ColumnHeaderCell>Queue</Table.ColumnHeaderCell>
            <Table.ColumnHeaderCell>Error</Table.ColumnHeaderCell>
            <Table.ColumnHeaderCell />
          </Table.Row>
        </Table.Header>
        <Table.Body>
          {deadLetters.map((deadLetter) => (
            <Table.Row key={deadLetter.id}>
              <Table.Cell>
                <Checkbox
                  aria-label={`Select ${deadLetter.id}`}
                  checked={selected.includes(deadLetter.id)}
                  onCheckedChange={(checked) =>
                    toggle(deadLetter.id, checked === true)
                  }
                />
              </Table.Cell>
              <Table.Cell className="whitespace-nowrap">
                <Link
                  href={`/dashboard/job-dead-letters/${deadLetter.id}`}
                  title={deadLetter.id}
                  className="text-[var(--accent-11)] hover:underline"
                >
                  {shortId(deadLetter.id)}
                </Link>
              </Table.Cell>
              <Table.Cell className="whitespace-nowrap">
                {formatDateTime(deadLetter.createdAt)}
              </Table.Cell>
              <Table.Cell>
                {deadLetter.sourceQueue ?? 'Unknown queue'}
              </Table.Cell>
              <Table.Cell>
                <Text size="2">{deadLetter.error ?? '—'}</Text>
              </Table.Cell>
              <Table.Cell>
                <Flex gap="2">
                  <RedriveDeadLetterButton deadLetter={deadLetter} />
                  <DeleteDeadLetterButton deadLetter={deadLetter} />
                </Flex>
              </Table.Cell>
            </Table.Row>
          ))}
        </Table.Body>
      </Table.Root>
      <ConfirmDialog
        open={pending !== null}
        onOpenChange={(next) => {
          if (busy) return
          if (!next) setPending(null)
          setFailure(null)
        }}
        onConfirm={handleConfirm}
        title={
          pending === 'redrive'
            ? `Re-drive ${redrivable.length} jobs?`
            : `Delete ${visibleSelected.length} dead letters?`
        }
        description={
          <>
            {pending === 'redrive'
              ? 'This puts each job back on the queue it failed on as a new job with its attempts reset. Anything it already did before it failed runs again, so fix the cause first.'
              : 'This removes the selected jobs for good. Nothing is retried.'}
            {failure && (
              <span className="mt-2 block text-[var(--red-11)]">{failure}</span>
            )}
          </>
        }
        confirmLabel={pending === 'redrive' ? 'Re-drive' : 'Delete'}
        cancelLabel="Cancel"
        color={pending === 'redrive' ? 'blue' : 'red'}
        loading={busy}
      />
    </>
  )
}
