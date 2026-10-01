'use client'

import { useState } from 'react'
import * as Sentry from '@sentry/nextjs'
import { Button, Dialog, Flex, Text, TextField } from '@radix-ui/themes'
import { useToast } from '@/components/Toast'
import { describeActionFailure } from '@/shared/util/actionFailure.util'
import { updateFilingUrlAndResubmit } from '@/app/dashboard/campaigns/actions'

interface EditFilingUrlActionProps {
  campaignId: number
  filingUrl: string
  onResolved: () => Promise<void> | void
}

export function EditFilingUrlAction({
  campaignId,
  filingUrl,
  onResolved,
}: EditFilingUrlActionProps) {
  const { showToast } = useToast()
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [draft, setDraft] = useState(filingUrl)

  const trimmed = draft.trim()
  const unsaveable = trimmed.length === 0 || trimmed === filingUrl

  async function handleSave() {
    if (unsaveable) return
    setSaving(true)
    try {
      const { error, retriedRunId, retryError } =
        await updateFilingUrlAndResubmit(campaignId, trimmed)
      if (error) {
        showToast(error)
        setSaving(false)
        return
      }
      showToast(
        retryError
          ? `Filing link updated, but resubmitting failed: ${retryError}`
          : retriedRunId
            ? 'Filing link updated — registration resubmitted'
            : 'Filing link updated — the next sweep will resubmit'
      )
      setOpen(false)
      await onResolved()
    } catch (error) {
      Sentry.captureException(error)
      showToast(describeActionFailure(error, 'Failed to update filing link'))
    }
    setSaving(false)
  }

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(next) => {
        if (saving) return
        setOpen(next)
        if (next) setDraft(filingUrl)
      }}
    >
      <Dialog.Trigger>
        {/* aria-label disambiguates from the committee row's plain "Edit" */}
        <Button
          variant="outline"
          size="1"
          disabled={saving}
          aria-label="Edit filing link"
        >
          Edit
        </Button>
      </Dialog.Trigger>
      <Dialog.Content maxWidth="480px">
        <Dialog.Title>Edit the filing link</Dialog.Title>
        <Dialog.Description size="2" mb="3">
          Point it at the official election-authority page showing this
          candidate&apos;s filing.
        </Dialog.Description>
        <TextField.Root
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          disabled={saving}
        />
        <Text size="1" color="gray" mt="2" as="p">
          Saving clears the review hold and resubmits — the new link is
          validated fresh on the next run. goodparty.org pages, the
          candidate&apos;s own site, and FEC links for non-federal races are
          rejected.
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
            Save and resubmit
          </Button>
        </Flex>
      </Dialog.Content>
    </Dialog.Root>
  )
}
