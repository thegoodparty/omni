'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Button, Dialog, Flex, Text, TextField } from '@radix-ui/themes'
import { useToast } from '@/components/Toast'
import { editSmsDate } from '../actions'

// The console's display convention is Eastern (see lib/utils/date.ts), so
// the picker reads and writes ET wall-clock time regardless of the
// viewer's browser zone.
const ET_TIME_ZONE = 'America/New_York'

const etParts = (value: Date): { date: string; time: string } => {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: ET_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(value)
  const get = (type: string) =>
    parts.find((part) => part.type === type)?.value ?? ''
  return {
    date: `${get('year')}-${get('month')}-${get('day')}`,
    time: `${get('hour')}:${get('minute')}`,
  }
}

// ET wall time -> instant: guess the wall time as UTC, read the guess back
// in ET, and correct by the difference. A second pass settles a guess that
// crossed a DST boundary.
const etToInstant = (dateStr: string, timeStr: string): Date => {
  let instant = new Date(`${dateStr}T${timeStr}:00Z`)
  for (let pass = 0; pass < 2; pass++) {
    const seen = etParts(instant)
    const seenAsUtc = new Date(`${seen.date}T${seen.time}:00Z`)
    const target = new Date(`${dateStr}T${timeStr}:00Z`)
    instant = new Date(
      instant.getTime() - (seenAsUtc.getTime() - target.getTime())
    )
  }
  return instant
}

interface EditDateActionProps {
  id: number
  sendAt: string | null
  scheduledLocalDate: string | null
}

export function EditDateAction({
  id,
  sendAt,
  scheduledLocalDate,
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
  const initialTime = current?.time ?? '09:00'
  const [dateDraft, setDateDraft] = useState(initialDate)
  const [timeDraft, setTimeDraft] = useState(initialTime)

  const unchanged = dateDraft === initialDate && timeDraft === initialTime

  async function handleSave() {
    if (!dateDraft || !timeDraft || unchanged) return
    const instant = etToInstant(dateDraft, timeDraft)
    if (instant.getTime() <= Date.now()) {
      showToast('The new send time must be in the future')
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
          setTimeDraft(initialTime)
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
        <Flex gap="3">
          <label style={{ flexGrow: 1 }}>
            <Text size="1" color="gray" as="p" mb="1">
              Send date (ET)
            </Text>
            <TextField.Root
              type="date"
              value={dateDraft}
              onChange={(event) => setDateDraft(event.target.value)}
              disabled={busy}
            />
          </label>
          <label>
            <Text size="1" color="gray" as="p" mb="1">
              Time (ET)
            </Text>
            <TextField.Root
              type="time"
              value={timeDraft}
              onChange={(event) => setTimeDraft(event.target.value)}
              disabled={busy}
            />
          </label>
        </Flex>
        <Text size="1" color="gray" mt="2" as="p">
          Canvassers still text 9am–9pm in each contact&apos;s local timezone on
          the chosen day.
        </Text>
        <Flex gap="3" mt="4" justify="end">
          <Dialog.Close>
            <Button variant="soft" color="gray" disabled={busy}>
              Cancel
            </Button>
          </Dialog.Close>
          <Button
            onClick={handleSave}
            disabled={busy || !dateDraft || !timeDraft || unchanged}
            loading={busy}
          >
            Save date
          </Button>
        </Flex>
      </Dialog.Content>
    </Dialog.Root>
  )
}
