'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { AlertDialog, Button, Flex } from '@radix-ui/themes'
import { useToast } from '@/components/Toast'
import { cancelSms } from '../actions'

interface CancelActionProps {
  id: number
  paid: boolean
}

export function CancelAction({ id, paid }: CancelActionProps) {
  const router = useRouter()
  const { showToast } = useToast()
  const [busy, setBusy] = useState(false)

  async function handleCancel() {
    setBusy(true)
    try {
      await cancelSms(id)
      showToast(
        paid
          ? 'Canceled — the vendor job is deleted and the payment refunded'
          : 'Canceled — the vendor job is deleted'
      )
      router.refresh()
    } catch (error) {
      showToast(
        error instanceof Error ? error.message : 'Failed to cancel campaign'
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <AlertDialog.Root>
      <AlertDialog.Trigger>
        <Button variant="outline" color="red" disabled={busy}>
          Cancel campaign
        </Button>
      </AlertDialog.Trigger>
      <AlertDialog.Content maxWidth="440px">
        <AlertDialog.Title>Cancel this campaign?</AlertDialog.Title>
        <AlertDialog.Description size="2">
          This permanently ends the send: the vendor job is deleted
          {paid
            ? ', the candidate is refunded in full,'
            : ' and any free-texts promo is returned,'}{' '}
          and the campaign cannot be re-queued. The candidate is not notified
          automatically.
        </AlertDialog.Description>
        <Flex gap="3" mt="4" justify="end">
          <AlertDialog.Cancel>
            <Button variant="soft" color="gray" disabled={busy}>
              Keep campaign
            </Button>
          </AlertDialog.Cancel>
          <AlertDialog.Action>
            <Button color="red" onClick={handleCancel} disabled={busy}>
              {busy ? 'Canceling…' : 'Cancel campaign'}
            </Button>
          </AlertDialog.Action>
        </Flex>
      </AlertDialog.Content>
    </AlertDialog.Root>
  )
}
