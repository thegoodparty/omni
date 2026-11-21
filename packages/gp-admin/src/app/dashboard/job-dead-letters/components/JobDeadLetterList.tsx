import Link from 'next/link'
import { Table, Text } from '@radix-ui/themes'
import type { JobDeadLetter } from '@goodparty_org/contracts'
import { formatDateTime } from '@/lib/utils/date'
import { RedriveDeadLetterButton } from './RedriveDeadLetterButton'

interface JobDeadLetterListProps {
  deadLetters: JobDeadLetter[]
}

export function JobDeadLetterList({ deadLetters }: JobDeadLetterListProps) {
  if (deadLetters.length === 0) {
    return (
      <Text color="gray" size="3">
        No dead letters right now.
      </Text>
    )
  }

  return (
    <Table.Root>
      <Table.Header>
        <Table.Row>
          <Table.ColumnHeaderCell>ID</Table.ColumnHeaderCell>
          <Table.ColumnHeaderCell>Queue</Table.ColumnHeaderCell>
          <Table.ColumnHeaderCell>Error</Table.ColumnHeaderCell>
          <Table.ColumnHeaderCell>Died</Table.ColumnHeaderCell>
          <Table.ColumnHeaderCell />
        </Table.Row>
      </Table.Header>
      <Table.Body>
        {deadLetters.map((deadLetter) => (
          <Table.Row key={deadLetter.id}>
            <Table.Cell>
              <Link
                href={`/dashboard/job-dead-letters/${deadLetter.id}`}
                className="text-[var(--accent-11)] hover:underline"
              >
                {deadLetter.id}
              </Link>
            </Table.Cell>
            <Table.Cell>{deadLetter.sourceQueue ?? 'Unknown queue'}</Table.Cell>
            <Table.Cell>
              <Text size="2">{deadLetter.error ?? '—'}</Text>
            </Table.Cell>
            <Table.Cell>{formatDateTime(deadLetter.createdAt)}</Table.Cell>
            <Table.Cell>
              <RedriveDeadLetterButton deadLetter={deadLetter} />
            </Table.Cell>
          </Table.Row>
        ))}
      </Table.Body>
    </Table.Root>
  )
}
