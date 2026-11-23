'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Checkbox, Flex, Table, Text } from '@radix-ui/themes'
import type { JobDeadLetter } from '@goodparty_org/contracts'
import { formatDateTime } from '@/lib/utils/date'
import { truncateMiddle } from '@/lib/utils/string'
import { DeleteDeadLetterButton } from './DeleteDeadLetterButton'
import { JobDeadLetterSelectionBar } from './JobDeadLetterSelectionBar'
import { RedriveDeadLetterButton } from './RedriveDeadLetterButton'

// The id column stays one line whatever the table does, so the queue, error
// and died columns keep the width they need.
const ID_DISPLAY_LENGTH = 10

interface JobDeadLetterListProps {
  deadLetters: JobDeadLetter[]
}

export function JobDeadLetterList({ deadLetters }: JobDeadLetterListProps) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())

  if (deadLetters.length === 0) {
    return (
      <Text color="gray" size="3">
        No dead letters right now.
      </Text>
    )
  }

  // Selection is by id, so it survives a refresh that keeps a row and drops
  // one that was handled. Every action is taken from what is visible, so a
  // row no longer on the page is not selected for anything.
  const selected = deadLetters.filter((deadLetter) =>
    selectedIds.has(deadLetter.id)
  )
  const everySelected =
    deadLetters.length > 0 && selected.length === deadLetters.length

  const toggle = (id: string) => {
    setSelectedIds((current) => {
      const next = new Set(current)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }

  const toggleAll = () => {
    setSelectedIds(
      everySelected
        ? new Set()
        : new Set(deadLetters.map((deadLetter) => deadLetter.id))
    )
  }

  return (
    <Flex direction="column" gap="3">
      {selected.length > 0 && (
        <JobDeadLetterSelectionBar
          selected={selected}
          onDone={() => setSelectedIds(new Set())}
        />
      )}
      <Table.Root>
        <Table.Header>
          <Table.Row>
            <Table.ColumnHeaderCell width="32px">
              <Checkbox
                checked={everySelected}
                onCheckedChange={toggleAll}
                aria-label={
                  everySelected
                    ? 'Deselect all dead letters'
                    : 'Select all dead letters'
                }
              />
            </Table.ColumnHeaderCell>
            <Table.ColumnHeaderCell>ID</Table.ColumnHeaderCell>
            <Table.ColumnHeaderCell>Queue</Table.ColumnHeaderCell>
            <Table.ColumnHeaderCell>Error</Table.ColumnHeaderCell>
            <Table.ColumnHeaderCell>Died</Table.ColumnHeaderCell>
            <Table.ColumnHeaderCell />
          </Table.Row>
        </Table.Header>
        <Table.Body>
          {deadLetters.map((deadLetter) => {
            const isSelected = selectedIds.has(deadLetter.id)
            return (
              <Table.Row
                key={deadLetter.id}
                className={isSelected ? 'bg-[var(--accent-2)]' : undefined}
              >
                <Table.Cell>
                  <Checkbox
                    checked={isSelected}
                    onCheckedChange={() => toggle(deadLetter.id)}
                    aria-label={`Select dead letter ${deadLetter.id}`}
                  />
                </Table.Cell>
                <Table.Cell>
                  <Link
                    href={`/dashboard/job-dead-letters/${deadLetter.id}`}
                    title={deadLetter.id}
                    className="whitespace-nowrap text-[var(--accent-11)] hover:underline"
                  >
                    {truncateMiddle(deadLetter.id, ID_DISPLAY_LENGTH)}
                  </Link>
                </Table.Cell>
                <Table.Cell>
                  {deadLetter.sourceQueue ?? 'Unknown queue'}
                </Table.Cell>
                <Table.Cell>
                  <Text size="2">{deadLetter.error ?? '—'}</Text>
                </Table.Cell>
                <Table.Cell className="whitespace-nowrap">
                  {formatDateTime(deadLetter.createdAt)}
                </Table.Cell>
                <Table.Cell>
                  <Flex gap="2">
                    <RedriveDeadLetterButton deadLetter={deadLetter} />
                    <DeleteDeadLetterButton deadLetter={deadLetter} />
                  </Flex>
                </Table.Cell>
              </Table.Row>
            )
          })}
        </Table.Body>
      </Table.Root>
    </Flex>
  )
}
