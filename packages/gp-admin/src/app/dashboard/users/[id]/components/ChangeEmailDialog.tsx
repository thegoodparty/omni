'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  Button,
  Callout,
  Dialog,
  Flex,
  Text,
  TextField,
} from '@radix-ui/themes'
import type { CrmEmailSync } from '@/shared/gpApi'
import { useToast } from '@/components/Toast'
import { describeActionFailure } from '@/shared/util/actionFailure.util'
import { useUser } from '../context/UserContext'
import { changeUserEmail } from '../changeEmail.actions'

const HUBSPOT_CONTACT_URL =
  'https://app.hubspot.com/contacts/21589597/record/0-1'

const ContactLink = ({ id }: { id: string }) => (
  <a
    href={`${HUBSPOT_CONTACT_URL}/${id}`}
    target="_blank"
    rel="noopener noreferrer"
  >
    {id}
  </a>
)

// Only the outcomes staff still have to act on in HubSpot.
const CrmFollowUp = ({
  crm,
  previousEmail,
}: {
  crm: CrmEmailSync
  previousEmail: string
}) => {
  if (crm.status === 'conflict' && crm.contactId && crm.conflictingContactId) {
    return (
      <Text size="2">
        HubSpot already has a contact with this email (
        <ContactLink id={crm.conflictingContactId} />
        ). Merge it with theirs (<ContactLink id={crm.contactId} />
        ).
      </Text>
    )
  }
  if (crm.status === 'failed' && crm.contactId) {
    return (
      <Text size="2">
        HubSpot didn&apos;t update. Change the email on contact{' '}
        <ContactLink id={crm.contactId} /> by hand.
      </Text>
    )
  }
  if (crm.previousEmailKept === false && crm.contactId) {
    return (
      <Text size="2">
        HubSpot didn&apos;t keep {previousEmail}. Add it as a secondary email on
        contact <ContactLink id={crm.contactId} /> by hand.
      </Text>
    )
  }
  return null
}

const needsFollowUp = (crm: CrmEmailSync) =>
  crm.status === 'conflict' ||
  crm.status === 'failed' ||
  crm.previousEmailKept === false

export function ChangeEmailDialog() {
  const { id: userId, email: currentEmail } = useUser()
  const router = useRouter()
  const { showToast } = useToast()
  const [open, setOpen] = useState(false)
  const [email, setEmail] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [followUp, setFollowUp] = useState<CrmEmailSync | null>(null)
  const [previousEmail, setPreviousEmail] = useState(currentEmail)
  const [isBusy, setIsBusy] = useState(false)

  function handleOpenChange(nextOpen: boolean) {
    if (!nextOpen) {
      if (followUp) router.refresh()
      setEmail('')
      setError(null)
      setFollowUp(null)
    }
    setOpen(nextOpen)
  }

  async function handleSubmit() {
    setIsBusy(true)
    setError(null)
    try {
      const result = await changeUserEmail(userId, email.trim())
      if (result.error !== null) {
        setError(result.error)
        return
      }
      const { crm } = result.data
      if (needsFollowUp(crm)) {
        setPreviousEmail(currentEmail)
        setFollowUp(crm)
        return
      }
      showToast(
        crm.status === 'no_contact'
          ? 'Email changed. They have no HubSpot contact.'
          : 'Email changed'
      )
      setOpen(false)
      setEmail('')
      router.refresh()
    } catch (failure) {
      setError(describeActionFailure(failure, "Couldn't change the email"))
    } finally {
      setIsBusy(false)
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={handleOpenChange}>
      <Dialog.Trigger>
        <Button size="1" variant="ghost">
          Change
        </Button>
      </Dialog.Trigger>

      <Dialog.Content maxWidth="480px">
        <Dialog.Title>What&apos;s their new email?</Dialog.Title>
        <Dialog.Description size="2" mb="4">
          They&apos;ll sign in with it, and their HubSpot contact moves to it.
        </Dialog.Description>

        {followUp ? (
          <>
            <Callout.Root color="amber">
              <Callout.Text>
                <Text as="div" size="2" weight="medium" mb="1">
                  Email changed.
                </Text>
                <CrmFollowUp crm={followUp} previousEmail={previousEmail} />
              </Callout.Text>
            </Callout.Root>
            <Flex mt="4" justify="end">
              <Dialog.Close>
                <Button type="button">Done</Button>
              </Dialog.Close>
            </Flex>
          </>
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault()
              if (email.trim()) handleSubmit()
            }}
          >
            <label>
              <Text as="div" size="2" weight="medium" mb="1">
                New email
              </Text>
              <TextField.Root
                type="email"
                value={email}
                placeholder={currentEmail}
                onChange={(e) => {
                  setEmail(e.target.value)
                  setError(null)
                }}
              />
            </label>

            {error && (
              <Callout.Root color="red" mt="3">
                <Callout.Text>{error}</Callout.Text>
              </Callout.Root>
            )}

            <Flex gap="3" mt="4" justify="end">
              <Dialog.Close>
                <Button
                  type="button"
                  variant="soft"
                  color="gray"
                  disabled={isBusy}
                >
                  Cancel
                </Button>
              </Dialog.Close>
              <Button
                type="submit"
                disabled={!email.trim() || isBusy}
                loading={isBusy}
              >
                Change email
              </Button>
            </Flex>
          </form>
        )}
      </Dialog.Content>
    </Dialog.Root>
  )
}
