'use client'

import { useState } from 'react'
import { AlertDialog, Button, Callout, Flex, Text } from '@radix-ui/themes'
import { useToast } from '@/components/Toast'
import { describeActionFailure } from '@/shared/util/actionFailure.util'
import { startWinReplyBackfill } from '../actions'

export function BackfillRepliesAction() {
  const { showToast } = useToast()
  const [starting, setStarting] = useState<'dry' | 'run' | null>(null)
  const [open, setOpen] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)

  async function start(dryRun: boolean) {
    setStarting(dryRun ? 'dry' : 'run')
    setFailure(null)
    try {
      const { error } = await startWinReplyBackfill(dryRun)
      if (error) {
        setFailure(error)
        return
      }
      showToast(
        dryRun
          ? 'Dry run started. Results are in the gp-api logs.'
          : 'Backfill started. Results are in the gp-api logs.'
      )
      setOpen(false)
    } catch (error) {
      setFailure(
        describeActionFailure(error, 'Failed to start the reply backfill')
      )
    } finally {
      setStarting(null)
    }
  }

  const busy = starting !== null

  return (
    <Flex align="center" gap="3" mt="4" wrap="wrap">
      <Text size="2" color="gray">
        Win reply backfill
      </Text>
      <Button
        variant="outline"
        disabled={busy}
        loading={starting === 'dry'}
        onClick={() => start(true)}
      >
        Dry run
      </Button>
      <AlertDialog.Root
        open={open}
        onOpenChange={(next) => {
          if (busy) return
          setOpen(next)
          setFailure(null)
        }}
      >
        <AlertDialog.Trigger>
          <Button disabled={busy}>Run backfill</Button>
        </AlertDialog.Trigger>
        <AlertDialog.Content maxWidth="440px">
          <AlertDialog.Title>Run the reply backfill?</AlertDialog.Title>
          <AlertDialog.Description size="2">
            This reads Peerly&apos;s reports for every Win send from the last 90
            days and saves any missing reply text. It can take a while and is
            safe to run twice.
          </AlertDialog.Description>
          {failure && (
            <Callout.Root color="red" role="alert" mt="3">
              <Callout.Text>{failure}</Callout.Text>
            </Callout.Root>
          )}
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
                  start(false)
                }}
                disabled={busy}
                loading={starting === 'run'}
              >
                Run backfill
              </Button>
            </AlertDialog.Action>
          </Flex>
        </AlertDialog.Content>
      </AlertDialog.Root>
    </Flex>
  )
}
