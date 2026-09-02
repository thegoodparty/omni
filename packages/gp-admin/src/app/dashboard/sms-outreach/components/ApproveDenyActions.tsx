'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { AlertDialog, Button, Dialog, Flex, TextArea } from '@radix-ui/themes'
import { useToast } from '@/components/Toast'
import { approveSms, denySms } from '../actions'

interface ApproveDenyActionsProps {
  id: number
}

export function ApproveDenyActions({ id }: ApproveDenyActionsProps) {
  const router = useRouter()
  const { showToast } = useToast()
  const [busy, setBusy] = useState(false)
  const [denyOpen, setDenyOpen] = useState(false)
  const [reason, setReason] = useState('')

  async function handleApprove() {
    setBusy(true)
    try {
      await approveSms(id)
      showToast('Approved — the send is booked with the vendor')
      router.refresh()
    } catch (error) {
      showToast(
        error instanceof Error ? error.message : 'Failed to approve campaign'
      )
    } finally {
      setBusy(false)
    }
  }

  async function handleDeny() {
    if (reason.trim().length === 0) return
    setBusy(true)
    try {
      await denySms(id, reason.trim())
      showToast('Denied — edit the message to re-queue it')
      setDenyOpen(false)
      router.refresh()
    } catch (error) {
      showToast(
        error instanceof Error ? error.message : 'Failed to deny campaign'
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <Flex gap="3">
      <AlertDialog.Root>
        <AlertDialog.Trigger>
          <Button disabled={busy} style={{ flexGrow: 1 }}>
            Approve &amp; book send
          </Button>
        </AlertDialog.Trigger>
        <AlertDialog.Content maxWidth="420px">
          <AlertDialog.Title>Approve this campaign?</AlertDialog.Title>
          <AlertDialog.Description size="2">
            This books the vendor&apos;s canvassers for the scheduled send date.
            It is the last GoodParty touch before the texts go out.
          </AlertDialog.Description>
          <Flex gap="3" mt="4" justify="end">
            <AlertDialog.Cancel>
              <Button variant="soft" color="gray" disabled={busy}>
                Cancel
              </Button>
            </AlertDialog.Cancel>
            <AlertDialog.Action>
              <Button onClick={handleApprove} disabled={busy}>
                {busy ? 'Booking…' : 'Approve'}
              </Button>
            </AlertDialog.Action>
          </Flex>
        </AlertDialog.Content>
      </AlertDialog.Root>

      <Dialog.Root open={denyOpen} onOpenChange={setDenyOpen}>
        <Dialog.Trigger>
          <Button variant="outline" color="red" disabled={busy}>
            Deny
          </Button>
        </Dialog.Trigger>
        <Dialog.Content maxWidth="480px">
          <Dialog.Title>Deny this campaign</Dialog.Title>
          <Dialog.Description size="2" mb="3">
            Deny is for the rare campaign that should not send as-is and
            can&apos;t be fixed with a quick edit. The reason is recorded
            internally; the candidate is not notified. Editing the message
            re-queues it for review.
          </Dialog.Description>
          <TextArea
            placeholder="What needs to change before this can send?"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            rows={4}
          />
          <Flex gap="3" mt="4" justify="end">
            <Dialog.Close>
              <Button variant="soft" color="gray" disabled={busy}>
                Cancel
              </Button>
            </Dialog.Close>
            <Button
              color="red"
              onClick={handleDeny}
              disabled={busy || reason.trim().length === 0}
            >
              {busy ? 'Denying…' : 'Deny'}
            </Button>
          </Flex>
        </Dialog.Content>
      </Dialog.Root>
    </Flex>
  )
}
