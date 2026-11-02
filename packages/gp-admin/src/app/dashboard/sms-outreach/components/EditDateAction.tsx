'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Button, Dialog, Flex, Text, TextField } from '@radix-ui/themes'
import { useToast } from '@/components/Toast'
import { formatLocalTimeString } from '@/lib/utils/date'
import { editSmsDate } from '../actions'
import { etParts, etToInstant } from './etDateTime'

interface EditDateActionProps {
  id: number
  sendAt: string | null
  scheduledLocalDate: string | null
  scheduledLocalTime: string | null
}

export function EditDateAction({
  id,
  sendAt,
  scheduledLocalDate,
  scheduledLocalTime,
}: EditDateActionProps) {
  const router = useRouter()
  const { showToast } = useToast()
  const [open, setOpen] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  // router.refresh() doesn't return a promise — a transition is the only way
  // to know the post-mutation re-render (fresh vendor/job data) has landed.
  const [isRefreshing, startTransition] = useTransition()
  const busy = submitting || isRefreshing

  const current = sendAt ? etParts(new Date(sendAt)) : null
  const initialDate = scheduledLocalDate ?? current?.date ?? ''
  const etTime = current?.time ?? '09:00'
  const [dateDraft, setDateDraft] = useState(initialDate)
  // Frozen at dialog open: the props can shift under an open dialog (a
  // background revalidation), and comparing the draft against live props
  // would then block a real edit or enable saving a stale draft.
  const [baseline, setBaseline] = useState(initialDate)
  const localStart = formatLocalTimeString(scheduledLocalTime) ?? '9am'

  const unchanged = dateDraft === baseline

  async function handleSave() {
    if (!dateDraft || unchanged) return
    const instant = etToInstant(dateDraft, etTime)
    if (instant.getTime() <= Date.now()) {
      showToast('The new send date must be in the future')
      return
    }
    setSubmitting(true)
    try {
      await editSmsDate(id, instant.toISOString(), dateDraft)
      showToast('Send date updated — the vendor window moved with it')
      setOpen(false)
      startTransition(() => router.refresh())
    } catch (error) {
      showToast(
        error instanceof Error ? error.message : 'Failed to update the date'
      )
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(next) => {
        if (busy) return
        setOpen(next)
        if (next) {
          setDateDraft(initialDate)
          setBaseline(initialDate)
        }
      }}
    >
      <Dialog.Trigger>
        <Button variant="outline" disabled={busy} loading={busy}>
          Edit date
        </Button>
      </Dialog.Trigger>
      <Dialog.Content maxWidth="420px">
        <Dialog.Title>Move the send date</Dialog.Title>
        <Dialog.Description size="2" mb="3">
          Peerly&apos;s job window moves to the new day, and a booked send is
          rebooked with the canvassers. An existing approval is kept.
        </Dialog.Description>
        <label>
          <Text size="1" color="gray" as="p" mb="1">
            Send date
          </Text>
          <TextField.Root
            type="date"
            value={dateDraft}
            onChange={(event) => setDateDraft(event.target.value)}
            disabled={busy}
          />
        </label>
        <Text size="1" color="gray" mt="2" as="p">
          Texts still start at {localStart} in each contact&apos;s local time.
        </Text>
        <Flex gap="3" mt="4" justify="end">
          <Dialog.Close>
            <Button variant="soft" color="gray" disabled={busy}>
              Cancel
            </Button>
          </Dialog.Close>
          <Button
            onClick={handleSave}
            disabled={busy || !dateDraft || unchanged}
            loading={busy}
          >
            Save date
          </Button>
        </Flex>
      </Dialog.Content>
    </Dialog.Root>
  )
}
