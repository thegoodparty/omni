'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import {
  Badge,
  Box,
  Callout,
  Flex,
  Table,
  Text,
  TextField,
} from '@radix-ui/themes'
import type { OutreachAwaitingResultsItem } from '@goodparty_org/contracts'
import { formatDateTime } from '@/lib/utils/date'
import { outreachTypeLabel } from '../types'

interface AwaitingResultsTableProps {
  items: OutreachAwaitingResultsItem[]
}

const isOverdue = (item: OutreachAwaitingResultsItem, now: number): boolean =>
  item.expectedBy !== null && new Date(item.expectedBy).getTime() < now

const matches = (item: OutreachAwaitingResultsItem, query: string): boolean => {
  const haystack = [
    item.name ?? '',
    item.organizationSlug,
    outreachTypeLabel(item.outreachType),
    item.id,
  ]
    .join(' ')
    .toLowerCase()
  return haystack.includes(query)
}

export function AwaitingResultsTable({ items }: AwaitingResultsTableProps) {
  const [search, setSearch] = useState('')

  // Read once per render rather than per row, so every row in a given
  // render is judged against the same instant.
  const now = Date.now()

  const visible = useMemo(() => {
    const query = search.trim().toLowerCase()
    const filtered = query
      ? items.filter((item) => matches(item, query))
      : items
    // Oldest expectation first: the queue reads top-down as "what is most
    // overdue". A send with no expected date sorts last rather than first.
    return [...filtered].sort((a, b) => {
      const aTime = a.expectedBy ? new Date(a.expectedBy).getTime() : Infinity
      const bTime = b.expectedBy ? new Date(b.expectedBy).getTime() : Infinity
      return aTime - bTime
    })
  }, [items, search])

  const overdueCount = items.filter((item) => isOverdue(item, now)).length

  return (
    <Box mt="4">
      <Flex justify="between" align="center" mb="3" gap="3" wrap="wrap">
        <Flex gap="2" align="center">
          <Badge size="2" color={items.length > 0 ? 'blue' : 'gray'}>
            {items.length} awaiting results
          </Badge>
          {overdueCount > 0 && (
            <Badge size="2" color="amber">
              {overdueCount} past due
            </Badge>
          )}
        </Flex>
        <TextField.Root
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search by send, org or id"
          style={{ minWidth: 240 }}
        />
      </Flex>

      {items.length === 0 ? (
        <Callout.Root color="gray">
          <Callout.Text>
            Nothing is waiting on results. A send appears here the moment it
            goes out and disappears once its results are in.
          </Callout.Text>
        </Callout.Root>
      ) : visible.length === 0 ? (
        <Text size="2" color="gray">
          No send matches that search.
        </Text>
      ) : (
        <Table.Root variant="surface">
          <Table.Header>
            <Table.Row>
              <Table.ColumnHeaderCell>Send</Table.ColumnHeaderCell>
              <Table.ColumnHeaderCell>Organization</Table.ColumnHeaderCell>
              <Table.ColumnHeaderCell>Type</Table.ColumnHeaderCell>
              <Table.ColumnHeaderCell align="right">
                Recipients
              </Table.ColumnHeaderCell>
              <Table.ColumnHeaderCell>Sent</Table.ColumnHeaderCell>
              <Table.ColumnHeaderCell>Results expected</Table.ColumnHeaderCell>
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {visible.map((item) => (
              // Keyed on kind AND id: a send and a poll can carry the
              // same id string, since the two come from different tables.
              <Table.Row key={`${item.kind}-${item.id}`}>
                <Table.Cell>
                  <Link
                    href={`/dashboard/outreach-results/${item.kind}/${item.id}`}
                    className="text-[var(--accent-11)] hover:underline"
                  >
                    {item.name ??
                      `${item.kind === 'poll' ? 'Poll' : 'Send'} ${item.id}`}
                  </Link>
                </Table.Cell>
                <Table.Cell>
                  <Text size="2">{item.organizationSlug}</Text>
                </Table.Cell>
                <Table.Cell>
                  <Badge color="gray">
                    {outreachTypeLabel(item.outreachType)}
                  </Badge>
                </Table.Cell>
                <Table.Cell align="right">
                  {item.recipientCount.toLocaleString()}
                </Table.Cell>
                <Table.Cell>{formatDateTime(item.sentAt)}</Table.Cell>
                <Table.Cell>
                  <Flex gap="2" align="center">
                    <Text size="2">{formatDateTime(item.expectedBy)}</Text>
                    {isOverdue(item, now) && (
                      <Badge color="amber">Past due</Badge>
                    )}
                  </Flex>
                </Table.Cell>
              </Table.Row>
            ))}
          </Table.Body>
        </Table.Root>
      )}
    </Box>
  )
}
