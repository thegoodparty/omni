'use client'

import { useState } from 'react'
import { Button, Dialog, Flex, Text, TextField } from '@radix-ui/themes'
import { useToast } from '@/components/Toast'
import { sendTestSms } from '../actions'

interface SendTestActionProps {
  id: number
}

const LAST_TEST_PHONE_KEY = 'sms-outreach-last-test-phone'

// localStorage can throw (private mode, blocked site data) — the
// convenience must never break the dialog.
function readLastPhone(): string {
  try {
    return window.localStorage.getItem(LAST_TEST_PHONE_KEY) ?? ''
  } catch {
    return ''
  }
}

function writeLastPhone(phone: string) {
  try {
    window.localStorage.setItem(LAST_TEST_PHONE_KEY, phone)
  } catch {
    // best-effort only
  }
}

const normalizePhone = (raw: string) => raw.replace(/\D/g, '')

const isValidPhone = (digits: string) =>
  digits.length === 10 || (digits.length === 11 && digits.startsWith('1'))

export function SendTestAction({ id }: SendTestActionProps) {
  const { showToast } = useToast()
  const [open, setOpen] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [phone, setPhone] = useState('')
  const digits = normalizePhone(phone)

  async function handleSend() {
    if (!isValidPhone(digits)) return
    setSubmitting(true)
    try {
      await sendTestSms(id, digits)
      writeLastPhone(phone)
      showToast('Test text sent — it can take a minute to arrive')
      setOpen(false)
    } catch (error) {
      showToast(
        error instanceof Error ? error.message : 'Failed to send the test text'
      )
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(next) => {
        if (submitting) return
        setOpen(next)
        if (next) setPhone(readLastPhone())
      }}
    >
      <Dialog.Trigger>
        <Button variant="outline" disabled={submitting} loading={submitting}>
          Send test text
        </Button>
      </Dialog.Trigger>
      <Dialog.Content maxWidth="440px">
        <Dialog.Title>Send yourself a test text</Dialog.Title>
        <Dialog.Description size="2" mb="3">
          Sends the message as it will send — a real text from the
          candidate&apos;s vendor job — to the phone number below only.
        </Dialog.Description>
        <TextField.Root
          type="tel"
          value={phone}
          onChange={(event) => setPhone(event.target.value)}
          placeholder="(555) 123-4567"
          disabled={submitting}
        />
        <Text size="1" color="gray" mt="2" as="p">
          US numbers only: 10 digits, or 11 starting with 1.
        </Text>
        <Flex gap="3" mt="4" justify="end">
          <Dialog.Close>
            <Button variant="soft" color="gray" disabled={submitting}>
              Cancel
            </Button>
          </Dialog.Close>
          <Button
            onClick={handleSend}
            disabled={submitting || !isValidPhone(digits)}
            loading={submitting}
          >
            Send test
          </Button>
        </Flex>
      </Dialog.Content>
    </Dialog.Root>
  )
}
