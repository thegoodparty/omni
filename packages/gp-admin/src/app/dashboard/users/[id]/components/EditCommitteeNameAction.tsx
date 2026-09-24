'use client'

import { useState } from 'react'
import { Button, Dialog, Flex, Text, TextField } from '@radix-ui/themes'
import { useToast } from '@/components/Toast'
import { updateCommitteeName } from '@/app/dashboard/campaigns/actions'

interface EditCommitteeNameActionProps {
  campaignId: number
  committeeName: string
  onSaved: (committeeName: string) => void
}

export function EditCommitteeNameAction({
  campaignId,
  committeeName,
  onSaved,
}: EditCommitteeNameActionProps) {
  const { showToast } = useToast()
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [draft, setDraft] = useState(committeeName)

  const trimmed = draft.trim()
  const unsaveable = trimmed.length === 0 || trimmed === committeeName

  async function handleSave() {
    if (unsaveable) return
    setSaving(true)
    try {
      const updated = await updateCommitteeName(campaignId, trimmed)
      showToast('Committee name updated')
      onSaved(updated.committeeName)
      setOpen(false)
    } catch (error) {
      showToast(
        error instanceof Error
          ? error.message
          : 'Failed to update committee name'
      )
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(next) => {
        if (saving) return
        setOpen(next)
        if (next) setDraft(committeeName)
      }}
    >
      <Dialog.Trigger>
        <Button variant="outline" size="1" disabled={saving}>
          Edit
        </Button>
      </Dialog.Trigger>
      <Dialog.Content maxWidth="480px">
        <Dialog.Title>Edit the committee name</Dialog.Title>
        <Dialog.Description size="2" mb="3">
          Updates the SMS &quot;Paid for by&quot; footer for future texts and
          the filing-form prefill.
        </Dialog.Description>
        <TextField.Root
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          disabled={saving}
        />
        <Text size="1" color="gray" mt="2" as="p">
          Texts already composed keep the old footer — edit those in the SMS
          console. The carrier-side brand registration is unchanged.
        </Text>
        <Flex gap="3" mt="4" justify="end">
          <Dialog.Close>
            <Button variant="soft" color="gray" disabled={saving}>
              Cancel
            </Button>
          </Dialog.Close>
          <Button
            onClick={handleSave}
            disabled={saving || unsaveable}
            loading={saving}
          >
            Save
          </Button>
        </Flex>
      </Dialog.Content>
    </Dialog.Root>
  )
}
