'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button, Dialog, Flex, Text, TextArea } from '@radix-ui/themes'
import { useToast } from '@/components/Toast'
import { editSms } from '../actions'

interface EditMessageActionProps {
  id: number
  script: string
}

export function EditMessageAction({ id, script }: EditMessageActionProps) {
  const router = useRouter()
  const { showToast } = useToast()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [draft, setDraft] = useState(script)

  async function handleSave() {
    if (draft.trim().length === 0 || draft === script) return
    setBusy(true)
    try {
      await editSms(id, draft)
      showToast('Message updated — it now needs a fresh approval')
      setOpen(false)
      router.refresh()
    } catch (error) {
      showToast(
        error instanceof Error ? error.message : 'Failed to edit message'
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (next) setDraft(script)
      }}
    >
      <Dialog.Trigger>
        <Button variant="outline" disabled={busy}>
          Edit message
        </Button>
      </Dialog.Trigger>
      <Dialog.Content maxWidth="560px">
        <Dialog.Title>Edit the message</Dialog.Title>
        <Dialog.Description size="2" mb="3">
          The corrected text sends under the candidate&apos;s name. An existing
          booking and approval are kept; saving clears a denial.
        </Dialog.Description>
        <TextArea
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          rows={8}
        />
        <Text size="1" color="gray" mt="2" as="p">
          Keep the opt-out line and the {'{first_name}'} tag intact.
        </Text>
        <Flex gap="3" mt="4" justify="end">
          <Dialog.Close>
            <Button variant="soft" color="gray" disabled={busy}>
              Cancel
            </Button>
          </Dialog.Close>
          <Button
            onClick={handleSave}
            disabled={busy || draft.trim().length === 0 || draft === script}
          >
            {busy ? 'Saving…' : 'Save message'}
          </Button>
        </Flex>
      </Dialog.Content>
    </Dialog.Root>
  )
}
