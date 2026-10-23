'use client'

import { useCallback, useEffect, useState } from 'react'
import * as Sentry from '@sentry/nextjs'
import {
  Badge,
  Button,
  Callout,
  Code,
  Dialog,
  Flex,
  Text,
  TextField,
} from '@radix-ui/themes'
import type { PersonLookupResult, PersonProfileLink } from '@/shared/gpApi'
import { ProtectedContent } from '@/components/ProtectedContent'
import { useToast } from '@/components/Toast'
import { PERMISSIONS } from '@/lib/permissions'
import { describeActionFailure } from '@/shared/util/actionFailure.util'
import { useUser } from '../context/UserContext'
import {
  findPublicProfile,
  getPublicProfileLink,
  linkPublicProfile,
} from '../publicProfile.actions'
import { DataRow } from './DataRow'
import { InfoCard } from './InfoCard'

/**
 * Which /people page this account owns. A user with no link sees "still
 * setting up your official record" in the webapp instead of the profile
 * editor, and the data platform cannot link someone whose person record also
 * holds another account (a duplicate or deleted signup), so this is where
 * staff link them by hand.
 */
export function PublicProfileCard() {
  const { id: userId } = useUser()
  const [link, setLink] = useState<PersonProfileLink | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)

  const load = useCallback(async () => {
    const result = await getPublicProfileLink(userId)
    setLink(result.data)
    setLoadError(result.error)
  }, [userId])

  useEffect(() => {
    load().catch((error) => {
      Sentry.captureException(error)
      setLoadError(
        describeActionFailure(error, "Couldn't load the public profile link")
      )
    })
  }, [load])

  return (
    <InfoCard
      title="Public profile"
      {...(link && !link.personId
        ? {
            action: (
              <ProtectedContent
                requiredPermission={PERMISSIONS.WRITE_USERS}
                hideWhenUnauthorized
              >
                <LinkPublicProfileDialog onLinked={setLink} />
              </ProtectedContent>
            ),
          }
        : {})}
    >
      {loadError && <Text color="red">{loadError}</Text>}
      {link && <LinkDetails link={link} />}
    </InfoCard>
  )
}

function LinkDetails({ link }: { link: PersonProfileLink }) {
  if (!link.personId) {
    return (
      <>
        <DataRow label="Status">
          <Badge color="amber" variant="soft">
            Not linked
          </Badge>
        </DataRow>
        <Text as="p" size="2" color="gray" mt="2">
          Their profile editor stays locked until this account is linked to a
          public profile.
        </Text>
      </>
    )
  }

  return (
    <>
      <DataRow label="Status">
        <Badge color="green" variant="soft">
          Linked
        </Badge>
      </DataRow>
      <DataRow label="Person">
        {link.profileUrl ? (
          <a href={link.profileUrl} target="_blank" rel="noopener noreferrer">
            {link.fullName ?? link.personId}
          </a>
        ) : (
          (link.fullName ?? 'Name unknown')
        )}
      </DataRow>
      <DataRow label="Person ID">
        <Code size="1">{link.personId}</Code>
      </DataRow>
      <DataRow label="Profile">
        {link.hasProfile ? 'Created' : 'Not created yet'}
      </DataRow>
    </>
  )
}

interface LinkPublicProfileDialogProps {
  onLinked: (link: PersonProfileLink) => void
}

/**
 * Two steps on purpose, like a takedown: nobody has a civics UUID to hand,
 * and linking the wrong page hands someone else's public profile to this
 * account. So the link resolves to a name first, and staff confirm it.
 */
export function LinkPublicProfileDialog({
  onLinked,
}: LinkPublicProfileDialogProps) {
  const { id: userId, firstName, lastName, email } = useUser()
  const { showToast } = useToast()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [subject, setSubject] = useState<PersonLookupResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isBusy, setIsBusy] = useState(false)

  const userName = [firstName, lastName].filter(Boolean).join(' ') || email

  function resetAll() {
    setQuery('')
    setSubject(null)
    setError(null)
  }

  function handleOpenChange(nextOpen: boolean) {
    if (!nextOpen) resetAll()
    setOpen(nextOpen)
  }

  async function run(action: () => Promise<void>, fallback: string) {
    setIsBusy(true)
    setError(null)
    try {
      await action()
    } catch (failure) {
      // A rejection here never reached gp-api (deploy skew, expired session),
      // so this catch is the failure's only trace anywhere.
      Sentry.captureException(failure)
      setError(describeActionFailure(failure, fallback))
    } finally {
      setIsBusy(false)
    }
  }

  const handleFind = () =>
    run(async () => {
      const result = await findPublicProfile(query.trim())
      setSubject(result.data)
      setError(result.error)
    }, 'No profile matches that link. Check it and try again.')

  const handleConfirm = () =>
    run(async () => {
      if (!subject) return
      const result = await linkPublicProfile(userId, subject.personId)
      if (result.error !== null) {
        setError(result.error)
        return
      }
      showToast('Profile linked')
      onLinked(result.data)
      resetAll()
      setOpen(false)
    }, "Couldn't link the profile")

  return (
    <Dialog.Root open={open} onOpenChange={handleOpenChange}>
      <Dialog.Trigger>
        <Button size="1" variant="outline">
          Link to public profile
        </Button>
      </Dialog.Trigger>

      <Dialog.Content maxWidth="520px">
        <Dialog.Title>Which public profile is theirs?</Dialog.Title>
        <Dialog.Description size="2" mb="4">
          Paste their goodparty.org/people link. You&apos;ll confirm before
          anything changes.
        </Dialog.Description>

        <form
          onSubmit={(e) => {
            e.preventDefault()
            if (query.trim()) handleFind()
          }}
        >
          <label>
            <Text as="div" size="2" weight="medium" mb="1">
              Profile link
            </Text>
            <TextField.Root
              value={query}
              placeholder="https://goodparty.org/people/jordan-reyes-a1b2c3d4"
              onChange={(e) => {
                setQuery(e.target.value)
                // A new link invalidates the person already confirmed below.
                setSubject(null)
                setError(null)
              }}
            />
          </label>

          {error && (
            <Callout.Root color="red" mt="3">
              <Callout.Text>{error}</Callout.Text>
            </Callout.Root>
          )}

          {subject && (
            <Callout.Root color="amber" mt="3">
              <Callout.Text>
                <Text as="div" size="2">
                  Link <strong>{userName}</strong> (user {userId}) to:
                </Text>
                <Text as="div" weight="bold" mt="1">
                  {subject.fullName ?? 'Name unknown'}
                </Text>
                <Text as="div" size="2">
                  {[subject.office, subject.state]
                    .filter(Boolean)
                    .join(' · ') || 'No office on record'}
                </Text>
                <Text as="div" size="1" mt="1">
                  <Code size="1">{subject.personId}</Code>
                </Text>
                <Text as="div" size="2" mt="2">
                  They&apos;ll be able to edit and publish this page.
                </Text>
              </Callout.Text>
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
            {subject ? (
              <Button
                type="button"
                onClick={handleConfirm}
                disabled={isBusy}
                loading={isBusy}
              >
                Link profile
              </Button>
            ) : (
              <Button
                type="submit"
                disabled={!query.trim() || isBusy}
                loading={isBusy}
              >
                Find profile
              </Button>
            )}
          </Flex>
        </form>
      </Dialog.Content>
    </Dialog.Root>
  )
}
