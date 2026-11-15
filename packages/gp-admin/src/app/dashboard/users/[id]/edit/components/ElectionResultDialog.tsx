'use client'

import { AlertDialog, Button, Flex } from '@radix-ui/themes'

interface ElectionResultDialogProps {
  open: boolean
  onCancel: () => void
  onDecide: (resetElectionResults: boolean) => void
}

export function ElectionResultDialog({
  open,
  onCancel,
  onDecide,
}: ElectionResultDialogProps) {
  return (
    <AlertDialog.Root
      open={open}
      onOpenChange={(next) => {
        if (!next) onCancel()
      }}
    >
      <AlertDialog.Content maxWidth="450px">
        <AlertDialog.Title>
          Clear the last election&apos;s result?
        </AlertDialog.Title>
        <AlertDialog.Description size="2">
          This campaign has a result from its last election. Clear it if the new
          date is for a new election.
        </AlertDialog.Description>
        <Flex gap="3" mt="4" justify="end">
          <AlertDialog.Cancel>
            <Button variant="soft" color="gray">
              Cancel
            </Button>
          </AlertDialog.Cancel>
          <Button variant="soft" onClick={() => onDecide(false)}>
            Keep result
          </Button>
          <Button onClick={() => onDecide(true)}>Clear result</Button>
        </Flex>
      </AlertDialog.Content>
    </AlertDialog.Root>
  )
}
