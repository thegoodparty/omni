'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import {
  AlertDialog,
  Button,
  Callout,
  Dialog,
  Flex,
  TextArea,
} from '@radix-ui/themes'
import { useToast } from '@/components/Toast'
import { describeActionFailure } from '@/shared/util/actionFailure.util'
import { approvePoll, denyPoll } from '../actions'

interface ApproveDenyActionsProps {
  id: number
  expansionId?: string
}

export function ApproveDenyActions({
  id,
  expansionId,
}: ApproveDenyActionsProps) {
  const router = useRouter()
  const { showToast } = useToast()
  const [submitting, setSubmitting] = useState(false)
  const [isRefreshing, startTransition] = useTransition()
  const busy = submitting || isRefreshing
  const [approveOpen, setApproveOpen] = useState(false)
  const [denyOpen, setDenyOpen] = useState(false)
  const [reason, setReason] = useState('')
  const [failure, setFailure] = useState<string | null>(null)

  // A failed decision usually means someone else decided first, so the page
  // refreshes to show the current state instead of retrying.
  async function run(
    action: () => Promise<{ error: string | null }>,
    success: string,
    fallback: string,
    close: () => void
  ) {
    setSubmitting(true)
    setFailure(null)
    try {
      const { error } = await action()
      if (error) {
        setFailure(error)
      } else {
        showToast(success)
      }
      close()
      startTransition(() => router.refresh())
    } catch (error) {
      setFailure(describeActionFailure(error, fallback))
      close()
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Flex direction="column" gap="3">
      {failure && (
        <Callout.Root color="red" role="alert">
          <Callout.Text>{failure}</Callout.Text>
        </Callout.Root>
      )}
      <Flex gap="3">
        <AlertDialog.Root
          open={approveOpen}
          onOpenChange={(next) => {
            if (!busy) setApproveOpen(next)
          }}
        >
          <AlertDialog.Trigger>
            <Button disabled={busy} loading={busy} style={{ flexGrow: 1 }}>
              Approve
            </Button>
          </AlertDialog.Trigger>
          <AlertDialog.Content maxWidth="420px">
            <AlertDialog.Title>Approve this poll?</AlertDialog.Title>
            <AlertDialog.Description size="2">
              The poll goes out on its send date. Once approved, it can&apos;t
              be approved again.
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
                    run(
                      () => approvePoll(id, expansionId),
                      'Approved',
                      'Failed to approve poll',
                      () => setApproveOpen(false)
                    )
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

        {!expansionId && (
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
              <Dialog.Title>Deny this poll</Dialog.Title>
              <Dialog.Description size="2" mb="3">
                The reason is recorded internally. The candidate is not
                notified.
              </Dialog.Description>
              <TextArea
                placeholder="What needs to change before this can send?"
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                rows={4}
                maxLength={2000}
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
                  onClick={() =>
                    run(
                      () => denyPoll(id, reason.trim()),
                      'Denied',
                      'Failed to deny poll',
                      () => setDenyOpen(false)
                    )
                  }
                  disabled={busy || reason.trim().length === 0}
                  loading={busy}
                >
                  Deny
                </Button>
              </Flex>
            </Dialog.Content>
          </Dialog.Root>
        )}
      </Flex>
    </Flex>
  )
}
