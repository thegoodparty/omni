'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import {
  Badge,
  Box,
  Button,
  Flex,
  Table,
  Tabs,
  Text,
  TextField,
} from '@radix-ui/themes'
import type { SmsApprovalQueueItem } from '@goodparty_org/contracts'
import { formatDate } from '@/lib/utils/date'
import {
  STATUS_COLORS,
  STATUS_LABELS,
  TAB_STATUSES,
  type QueueTab,
} from '../types'

interface SmsQueueProps {
  items: SmsApprovalQueueItem[]
}

type SortKey = 'candidate' | 'sendDate' | 'assigned'
type SortDir = 'asc' | 'desc'

const TAB_LABELS: Record<QueueTab, string> = {
  awaiting: 'Awaiting review',
  booked: 'Booked',
  denied: 'Denied',
  canceled: 'Canceled',
}

const tabLabel = (tab: QueueTab, count: number) =>
  `${TAB_LABELS[tab]} (${count})`

const compareItems = (
  a: SmsApprovalQueueItem,
  b: SmsApprovalQueueItem,
  key: SortKey
): number => {
  if (key === 'candidate') {
    return (a.candidateName ?? '').localeCompare(b.candidateName ?? '')
  }
  if (key === 'assigned') {
    // Unassigned rows sort last so assigned work groups together.
    if (!a.assignedPa || !b.assignedPa) {
      return (a.assignedPa ? 0 : 1) - (b.assignedPa ? 0 : 1)
    }
    return a.assignedPa.localeCompare(b.assignedPa)
  }
  // Rows without a send date sort last regardless of direction.
  const aTime = a.sendAt ? new Date(a.sendAt).getTime() : Infinity
  const bTime = b.sendAt ? new Date(b.sendAt).getTime() : Infinity
  return aTime - bTime
}

export function SmsQueue({ items }: SmsQueueProps) {
  const router = useRouter()
  const [tab, setTab] = useState<QueueTab>('awaiting')
  const [search, setSearch] = useState('')
  const [sortKey, setSortKey] = useState<SortKey>('sendDate')
  const [sortDir, setSortDir] = useState<SortDir>('asc')

  const byTab = (key: QueueTab) =>
    items.filter((item) => TAB_STATUSES[key].includes(item.approvalStatus))

  const visible = useMemo(() => {
    const query = search.trim().toLowerCase()
    const filtered = items.filter(
      (item) =>
        TAB_STATUSES[tab].includes(item.approvalStatus) &&
        (query.length === 0 ||
          [item.candidateName, item.name, item.campaignSlug].some((field) =>
            (field ?? '').toLowerCase().includes(query)
          ))
    )
    const sorted = [...filtered].sort((a, b) => compareItems(a, b, sortKey))
    return sortDir === 'asc' ? sorted : sorted.reverse()
  }, [items, tab, search, sortKey, sortDir])

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir(sortDir === 'asc' ? 'desc' : 'asc')
    } else {
      setSortKey(key)
      setSortDir('asc')
    }
  }

  const sortIndicator = (key: SortKey) =>
    sortKey === key ? (sortDir === 'asc' ? ' ▲' : ' ▼') : ''

  return (
    <Box mt="4">
      <Flex
        gap="3"
        align="center"
        justify="between"
        wrap="wrap"
        direction={{ initial: 'column', sm: 'row' }}
      >
        <Tabs.Root
          value={tab}
          onValueChange={(value) => setTab(value as QueueTab)}
        >
          <Tabs.List>
            {(['awaiting', 'booked', 'denied', 'canceled'] as const).map(
              (key) => (
                <Tabs.Trigger key={key} value={key}>
                  {tabLabel(key, byTab(key).length)}
                </Tabs.Trigger>
              )
            )}
          </Tabs.List>
        </Tabs.Root>
        <TextField.Root
          placeholder="Search candidate, campaign, or slug…"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          aria-label="Search campaigns"
          style={{ minWidth: 220 }}
        />
      </Flex>

      {visible.length === 0 ? (
        <Text color="gray" size="3" mt="4" as="p">
          {search.trim().length > 0
            ? 'No campaigns match your search.'
            : 'Nothing here right now.'}
        </Text>
      ) : (
        <Table.Root mt="4">
          <Table.Header>
            <Table.Row>
              <Table.ColumnHeaderCell
                aria-sort={
                  sortKey === 'candidate'
                    ? sortDir === 'asc'
                      ? 'ascending'
                      : 'descending'
                    : undefined
                }
              >
                <Button
                  variant="ghost"
                  color="gray"
                  onClick={() => toggleSort('candidate')}
                >
                  Candidate{sortIndicator('candidate')}
                </Button>
              </Table.ColumnHeaderCell>
              <Table.ColumnHeaderCell>Campaign</Table.ColumnHeaderCell>
              <Table.ColumnHeaderCell
                aria-sort={
                  sortKey === 'assigned'
                    ? sortDir === 'asc'
                      ? 'ascending'
                      : 'descending'
                    : undefined
                }
              >
                <Button
                  variant="ghost"
                  color="gray"
                  onClick={() => toggleSort('assigned')}
                >
                  Assigned to{sortIndicator('assigned')}
                </Button>
              </Table.ColumnHeaderCell>
              <Table.ColumnHeaderCell
                aria-sort={
                  sortKey === 'sendDate'
                    ? sortDir === 'asc'
                      ? 'ascending'
                      : 'descending'
                    : undefined
                }
              >
                <Button
                  variant="ghost"
                  color="gray"
                  onClick={() => toggleSort('sendDate')}
                >
                  Send date{sortIndicator('sendDate')}
                </Button>
              </Table.ColumnHeaderCell>
              <Table.ColumnHeaderCell>Audience</Table.ColumnHeaderCell>
              <Table.ColumnHeaderCell>Standards</Table.ColumnHeaderCell>
              <Table.ColumnHeaderCell>Readiness</Table.ColumnHeaderCell>
              <Table.ColumnHeaderCell>Status</Table.ColumnHeaderCell>
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {visible.map((item) => (
              <Table.Row
                key={item.id}
                className="cursor-pointer hover:bg-[var(--gray-a2)]"
                onClick={(event) => {
                  // Leave modified clicks alone — the campaign link is the
                  // open-in-new-tab affordance; the row must not hijack.
                  if (event.metaKey || event.ctrlKey || event.shiftKey) return
                  router.push(`/dashboard/sms-outreach/${item.id}`)
                }}
              >
                <Table.Cell>
                  <Flex direction="column">
                    <Text size="2">{item.candidateName ?? '—'}</Text>
                    <Text size="1" color="gray">
                      {item.campaignSlug}
                    </Text>
                  </Flex>
                </Table.Cell>
                <Table.Cell>
                  <Link
                    href={`/dashboard/sms-outreach/${item.id}`}
                    className="text-[var(--accent-11)] hover:underline"
                    onClick={(event) => event.stopPropagation()}
                  >
                    {item.name ?? `Campaign ${item.id}`}
                  </Link>
                </Table.Cell>
                <Table.Cell>
                  {item.assignedPa ?? (
                    <Text size="2" color="gray">
                      Unassigned
                    </Text>
                  )}
                </Table.Cell>
                <Table.Cell>
                  {item.sendAt ? formatDate(item.sendAt) : '—'}
                </Table.Cell>
                <Table.Cell>
                  {(
                    item.billableTextCount ?? item.textCount
                  )?.toLocaleString() ?? '—'}
                  {item.paid ? '' : ' (free)'}
                </Table.Cell>
                <Table.Cell>
                  {item.standards === null ? (
                    <Badge color="gray">No message</Badge>
                  ) : item.standards.passed ? (
                    <Badge color="green">Pass</Badge>
                  ) : (
                    <Badge color="red">
                      {item.standards.failures.length} issue
                      {item.standards.failures.length === 1 ? '' : 's'}
                    </Badge>
                  )}
                </Table.Cell>
                <Table.Cell>
                  {item.approvalStatus === 'canceled' ? (
                    <Text size="2" color="gray">
                      —
                    </Text>
                  ) : item.job === null ? (
                    <Badge color="gray">Vendor read failed</Badge>
                  ) : item.job.deliverabilityCheckError ? (
                    <Badge color="red">Deliverability error</Badge>
                  ) : (
                    <Badge color="green">Ready</Badge>
                  )}
                </Table.Cell>
                <Table.Cell>
                  <Badge color={STATUS_COLORS[item.approvalStatus]}>
                    {STATUS_LABELS[item.approvalStatus]}
                  </Badge>
                </Table.Cell>
              </Table.Row>
            ))}
          </Table.Body>
        </Table.Root>
      )}
    </Box>
  )
}
