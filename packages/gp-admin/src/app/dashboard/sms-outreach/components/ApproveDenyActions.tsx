'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import {
  AlertDialog,
  Button,
  Dialog,
  Flex,
  Text,
  TextArea,
} from '@radix-ui/themes'
import { useToast } from '@/components/Toast'
import { approveSms, denySms } from '../actions'
import { etParts } from './etDateTime'

interface ApproveDenyActionsProps {
  id: number
  scheduledLocalDate: string | null
  sendAt: string | null
}

// Approval books canvassers for a send window the vendor has already closed
// once the day is behind us, which is what gp-api refuses. Read the day the
// same way it does — Eastern — so the button and the API never disagree about
// which day it is. A row predating scheduledLocalDate falls back to the ET day
// of its stored instant, the last day on record for it.
const blockedReason = (
  scheduledLocalDate: string | null,
  sendAt: string | null
): string | null => {
  const sendDay =
    scheduledLocalDate ?? (sendAt ? etParts(new Date(sendAt)).date : null)
  if (sendDay === null) return 'No send date on record — set a date first'
  return sendDay < etParts(new Date()).date
    ? 'Send date passed — set a new date first'
    : null
}

export function ApproveDenyActions({
  id,
  scheduledLocalDate,
  sendAt,
}: ApproveDenyActionsProps) {
  const router = useRouter()
  const { showToast } = useToast()
  const [submitting, setSubmitting] = useState(false)
  // router.refresh() doesn't return a promise — a transition is the only way
  // to know the post-mutation re-render (fresh vendor/job data) has landed.
  const [isRefreshing, startTransition] = useTransition()
  const busy = submitting || isRefreshing
  const [approveOpen, setApproveOpen] = useState(false)
  const [denyOpen, setDenyOpen] = useState(false)
  const [reason, setReason] = useState('')
  const approveBlockedReason = blockedReason(scheduledLocalDate, sendAt)

  async function handleApprove() {
    setSubmitting(true)
    try {
      const { error } = await approveSms(id)
      if (error) {
        showToast(error)
        return
      }
      showToast('Approved — the send is booked with the vendor')
      setApproveOpen(false)
      startTransition(() => router.refresh())
    } catch (error) {
      showToast(
        error instanceof Error ? error.message : 'Failed to approve campaign'
      )
    } finally {
      setSubmitting(false)
    }
  }

  async function handleDeny() {
    if (reason.trim().length === 0) return
    setSubmitting(true)
    try {
      await denySms(id, reason.trim())
      showToast('Denied — edit the message to re-queue it')
      setDenyOpen(false)
      startTransition(() => router.refresh())
    } catch (error) {
      showToast(
        error instanceof Error ? error.message : 'Failed to deny campaign'
      )
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Flex direction="column" gap="2">
      <Flex gap="3">
        <AlertDialog.Root
          open={approveOpen}
          onOpenChange={(next) => {
            if (!busy) setApproveOpen(next)
          }}
        >
          <AlertDialog.Trigger>
            <Button
              disabled={busy || approveBlockedReason !== null}
              loading={busy}
              style={{ flexGrow: 1 }}
            >
              Approve &amp; book send
            </Button>
          </AlertDialog.Trigger>
          <AlertDialog.Content maxWidth="420px">
            <AlertDialog.Title>Approve this campaign?</AlertDialog.Title>
            <AlertDialog.Description size="2">
              This books the vendor&apos;s canvassers for the scheduled send
              date. It is the last GoodParty touch before the texts go out.
            </AlertDialog.Description>
            <Flex gap="3" mt="4" justify="end">
              <AlertDialog.Cancel>
                <Button variant="soft" color="gray" disabled={busy}>
                  Cancel
                </Button>
              </AlertDialog.Cancel>
              <AlertDialog.Action>
                <Button
                  onClick={(event) => {
                    event.preventDefault()
                    handleApprove()
                  }}
                  disabled={busy}
                  loading={busy}
                >
                  Approve
                </Button>
              </AlertDialog.Action>
            </Flex>
          </AlertDialog.Content>
        </AlertDialog.Root>

        <Dialog.Root
          open={denyOpen}
          onOpenChange={(next) => {
            if (!busy) setDenyOpen(next)
          }}
        >
          <Dialog.Trigger>
            <Button
              variant="outline"
              color="red"
              disabled={busy}
              loading={busy}
            >
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
              disabled={busy}
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
                loading={busy}
              >
                Deny
              </Button>
            </Flex>
          </Dialog.Content>
        </Dialog.Root>
      </Flex>
      {approveBlockedReason !== null && (
        <Text size="1" color="amber" mt="2" as="p">
          {approveBlockedReason}
        </Text>
      )}
    </Flex>
  )
}
