'use client'

import { useState } from 'react'
import { Table, Text, IconButton, Flex, Badge } from '@radix-ui/themes'
import { HiTrash } from 'react-icons/hi'
import type { EcanvasserSummary } from '@goodparty_org/sdk'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { useToast } from '@/components/Toast'
import { deleteEcanvasser } from '../actions'

interface EcanvasserTableProps {
  ecanvassers: EcanvasserSummary[]
  onUpdate: () => void
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat().format(value)
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return '—'
  return new Date(dateStr).toLocaleString('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
  })
}

export function EcanvasserTable({
  ecanvassers,
  onUpdate,
}: EcanvasserTableProps) {
  const [deletingId, setDeletingId] = useState<number | null>(null)
  const [confirmId, setConfirmId] = useState<number | null>(null)
  const { showToast } = useToast()

  if (ecanvassers.length === 0) {
    return (
      <Text color="gray" size="3">
        No ecanvasser integrations found.
      </Text>
    )
  }

  async function handleDelete() {
    if (confirmId === null) return
    setDeletingId(confirmId)
    try {
      await deleteEcanvasser(confirmId)
      onUpdate()
    } catch {
      showToast('Failed to delete integration')
    } finally {
      setDeletingId(null)
      setConfirmId(null)
    }
  }

  return (
    <>
      <Table.Root>
        <Table.Header>
          <Table.Row>
            <Table.ColumnHeaderCell>Campaign ID</Table.ColumnHeaderCell>
            <Table.ColumnHeaderCell>Email</Table.ColumnHeaderCell>
            <Table.ColumnHeaderCell>Contacts</Table.ColumnHeaderCell>
            <Table.ColumnHeaderCell>Houses</Table.ColumnHeaderCell>
            <Table.ColumnHeaderCell>Interactions</Table.ColumnHeaderCell>
            <Table.ColumnHeaderCell>Last Sync</Table.ColumnHeaderCell>
            <Table.ColumnHeaderCell>Error</Table.ColumnHeaderCell>
            <Table.ColumnHeaderCell>Actions</Table.ColumnHeaderCell>
          </Table.Row>
        </Table.Header>
        <Table.Body>
          {ecanvassers.map((item) => (
            <Table.Row key={item.campaignId}>
              <Table.Cell>{item.campaignId ?? '—'}</Table.Cell>
              <Table.Cell>{item.email ?? '—'}</Table.Cell>
              <Table.Cell>{formatNumber(item.contacts)}</Table.Cell>
              <Table.Cell>{formatNumber(item.houses)}</Table.Cell>
              <Table.Cell>{formatNumber(item.interactions)}</Table.Cell>
              <Table.Cell>{formatDate(item.lastSync)}</Table.Cell>
              <Table.Cell>
                {item.error ? <Badge color="red">{item.error}</Badge> : '—'}
              </Table.Cell>
              <Table.Cell>
                <Flex>
                  <IconButton
                    variant="ghost"
                    color="red"
                    aria-label={`Delete integration for ${item.email ?? `campaign ${item.campaignId}`}`}
                    onClick={() => setConfirmId(item.campaignId ?? null)}
                    disabled={
                      item.campaignId === undefined ||
                      deletingId === item.campaignId
                    }
                  >
                    <HiTrash />
                  </IconButton>
                </Flex>
              </Table.Cell>
            </Table.Row>
          ))}
        </Table.Body>
      </Table.Root>

      <ConfirmDialog
        open={confirmId !== null}
        onOpenChange={(open) => {
          if (!open) setConfirmId(null)
        }}
        onConfirm={handleDelete}
        title="Delete Integration"
        description="Are you sure you want to delete this ecanvasser integration? This action cannot be undone."
        confirmLabel="Delete"
        loading={deletingId !== null}
      />
    </>
  )
}
