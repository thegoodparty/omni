'use client'

import { useState } from 'react'
import {
  Button,
  Callout,
  Dialog,
  Flex,
  Text,
  TextField,
} from '@radix-ui/themes'
import { HiClipboardCopy, HiExclamation, HiLink } from 'react-icons/hi'
import { useToast } from '@/components/Toast'
import { createSignInLink } from '../../actions'

interface SignInLinkButtonProps {
  userId: number
}

interface SignInLink {
  url: string
  expiresAt: string
}

function describeExpiry(expiresAt: string): string {
  const expiry = new Date(expiresAt)
  const clockTime = expiry.toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  })
  const minutes = Math.round((expiry.getTime() - Date.now()) / 60_000)

  if (minutes <= 0) return `expired at ${clockTime}`
  if (minutes < 60) {
    return `expires in ${minutes} minute${minutes === 1 ? '' : 's'}, at ${clockTime}`
  }

  const hours = Math.round(minutes / 60)
  return `expires in ${hours} hour${hours === 1 ? '' : 's'}, at ${clockTime}`
}

export function SignInLinkButton({ userId }: SignInLinkButtonProps) {
  const { showToast } = useToast()
  const [loading, setLoading] = useState(false)
  const [link, setLink] = useState<SignInLink | null>(null)
  const [copied, setCopied] = useState(false)

  async function handleCreate() {
    setLoading(true)
    try {
      // Deliberately no window.open: the whole point is to hand the link to
      // the real user, not to open a session in this staff browser.
      setLink(await createSignInLink(userId))
      setCopied(false)
      setLoading(false)
    } catch (error) {
      showToast(
        error instanceof Error
          ? error.message
          : 'Failed to create sign-in link',
        'error'
      )
      setLoading(false)
    }
  }

  async function handleCopy() {
    if (!link) return
    try {
      await navigator.clipboard.writeText(link.url)
      setCopied(true)
      showToast('Link copied. Send it only to the user directly.')
    } catch {
      showToast(
        'Could not copy the link. Select it and copy manually.',
        'error'
      )
    }
  }

  function handleOpenChange(nextOpen: boolean) {
    if (!nextOpen) {
      setLink(null)
      setCopied(false)
    }
  }

  return (
    <>
      <Button variant="outline" onClick={handleCreate} disabled={loading}>
        <HiLink className="w-4 h-4" />
        {loading ? 'Creating link...' : 'Sign-in link'}
      </Button>

      <Dialog.Root open={link !== null} onOpenChange={handleOpenChange}>
        <Dialog.Content maxWidth="520px">
          <Dialog.Title>One-time sign-in link</Dialog.Title>
          <Dialog.Description size="2" mb="4">
            Send this to the user so they can sign in as themselves.
          </Dialog.Description>

          <Flex direction="column" gap="3">
            <label>
              <Text as="div" size="2" weight="medium" mb="1">
                Link
              </Text>
              <TextField.Root
                value={link?.url ?? ''}
                readOnly
                onFocus={(e) => e.currentTarget.select()}
              />
            </label>

            <Callout.Root color="red">
              <Callout.Icon>
                <HiExclamation />
              </Callout.Icon>
              <Callout.Text>
                <Text as="div" weight="bold">
                  Do not give this link to anyone except the user directly. It
                  provides unmitigated access to the user&apos;s account.
                </Text>
                <Text as="div" mt="1">
                  {link &&
                    `It works once, and ${describeExpiry(link.expiresAt)}.`}
                </Text>
              </Callout.Text>
            </Callout.Root>
          </Flex>

          <Flex gap="3" mt="4" justify="end">
            <Dialog.Close>
              <Button type="button" variant="soft" color="gray">
                Done
              </Button>
            </Dialog.Close>
            <Button type="button" onClick={handleCopy}>
              <HiClipboardCopy className="w-4 h-4" />
              {copied ? 'Copied' : 'Copy link'}
            </Button>
          </Flex>
        </Dialog.Content>
      </Dialog.Root>
    </>
  )
}
