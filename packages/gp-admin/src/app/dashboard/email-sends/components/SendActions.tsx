'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import * as Sentry from '@sentry/nextjs'
import { AlertDialog, Button, Callout, Flex } from '@radix-ui/themes'
import { useToast } from '@/components/Toast'
import { describeActionFailure } from '@/shared/util/actionFailure.util'
import { cancelEmailSend, resumeEmailSend } from '../actions'

interface SendActionsProps {
  outreachId: number
  canResume: boolean
}

export function SendActions({ outreachId, canResume }: SendActionsProps) {
  const router = useRouter()
  const { showToast } = useToast()
  const [busy, setBusy] = useState(false)
  const [open, setOpen] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)

  const run = async (
    action: typeof resumeEmailSend,
    done: string,
    fallback: string
  ) => {
    setBusy(true)
    setFailure(null)
    try {
      const { error } = await action(outreachId)
      if (error) {
        setFailure(error)
        return false
      }
      showToast(done)
      router.refresh()
      return true
    } catch (error) {
      Sentry.captureException(error)
      setFailure(describeActionFailure(error, fallback))
      return false
    } finally {
      setBusy(false)
    }
  }

  return (
    <Flex gap="2" align="center">
      {canResume && (
        <Button
          size="1"
          disabled={busy}
          onClick={() =>
            run(resumeEmailSend, 'Send resumed', 'Failed to resume send')
          }
        >
          Resume
        </Button>
      )}
      <AlertDialog.Root
        open={open}
        onOpenChange={(next) => {
          if (busy) return
          setOpen(next)
          setFailure(null)
        }}
      >
        <AlertDialog.Trigger>
          <Button size="1" variant="outline" color="red" disabled={busy}>
            Cancel
          </Button>
        </AlertDialog.Trigger>
        <AlertDialog.Content maxWidth="440px">
          <AlertDialog.Title>Cancel this send?</AlertDialog.Title>
          <AlertDialog.Description size="2">
            This stops the send for good. Emails already sent are charged;
            nothing else goes out.
          </AlertDialog.Description>
          {failure && (
            <Callout.Root color="red" role="alert" mt="3">
              <Callout.Text>{failure}</Callout.Text>
            </Callout.Root>
          )}
          <Flex gap="3" mt="4" justify="end">
            <AlertDialog.Cancel>
              <Button variant="soft" color="gray" disabled={busy}>
                Keep send
              </Button>
            </AlertDialog.Cancel>
            <AlertDialog.Action>
              <Button
                color="red"
                disabled={busy}
                loading={busy}
                onClick={async (event) => {
                  event.preventDefault()
                  const ok = await run(
                    cancelEmailSend,
                    'Send canceled',
                    'Failed to cancel send'
                  )
                  if (ok) setOpen(false)
                }}
              >
                Cancel send
              </Button>
            </AlertDialog.Action>
          </Flex>
        </AlertDialog.Content>
      </AlertDialog.Root>
      {failure && !open && (
        <Callout.Root color="red" role="alert" size="1">
          <Callout.Text>{failure}</Callout.Text>
        </Callout.Root>
      )}
    </Flex>
  )
}
