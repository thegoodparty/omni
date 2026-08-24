'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod/v4'
import {
  Button,
  Callout,
  Code,
  Dialog,
  Flex,
  Text,
  TextArea,
  TextField,
} from '@radix-ui/themes'
import { HiPlus } from 'react-icons/hi'
import type { PersonLookupResult } from '@goodparty_org/sdk'
import { ErrorText } from '@/components/ErrorText'
import { FORM_MODE } from '@/shared/constants/form'
import { useToast } from '@/components/Toast'
import { lookupPerson, removePersonProfile } from '../actions'

const lookupSchema = z.object({
  query: z.string().min(1, 'Paste the /people URL or slug'),
  note: z.string().max(2000).optional(),
})

type LookupFormData = z.infer<typeof lookupSchema>

/**
 * Two steps on purpose. The endpoints are keyed by a civics UUID that nobody
 * has to hand, and a mis-keyed one takes down the wrong person's page with no
 * error to notice — so the operator resolves the URL to a name first and has
 * to confirm it before anything is written.
 */
export function AddPersonRemoval() {
  const router = useRouter()
  const { showToast } = useToast()
  const [open, setOpen] = useState(false)
  const [isBusy, setIsBusy] = useState(false)
  const [subject, setSubject] = useState<PersonLookupResult | null>(null)
  const [lookupError, setLookupError] = useState<string | null>(null)

  const {
    register,
    getValues,
    reset,
    formState: { errors, isValid },
  } = useForm<LookupFormData>({
    mode: FORM_MODE.ON_CHANGE,
    resolver: zodResolver(lookupSchema),
    defaultValues: { query: '', note: '' },
  })

  function resetAll() {
    reset()
    setSubject(null)
    setLookupError(null)
  }

  function handleOpenChange(nextOpen: boolean) {
    if (!nextOpen) resetAll()
    setOpen(nextOpen)
  }

  async function handleLookup() {
    const parsed = lookupSchema.safeParse(getValues())
    if (!parsed.success) return

    setIsBusy(true)
    setLookupError(null)
    try {
      setSubject(await lookupPerson(parsed.data.query))
    } catch {
      setSubject(null)
      setLookupError(
        'No person matches that URL or slug. Check it and try again.'
      )
    } finally {
      setIsBusy(false)
    }
  }

  async function handleConfirm() {
    if (!subject) return

    setIsBusy(true)
    try {
      await removePersonProfile(subject.personId, getValues().note ?? '')
      showToast('Profile removed')
      resetAll()
      setOpen(false)
      router.refresh()
    } catch (error) {
      showToast(
        error instanceof Error ? error.message : 'Failed to remove profile'
      )
    } finally {
      setIsBusy(false)
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={handleOpenChange}>
      <Dialog.Trigger>
        <Button>
          <HiPlus className="w-4 h-4" />
          Remove a profile
        </Button>
      </Dialog.Trigger>

      <Dialog.Content maxWidth="520px">
        <Dialog.Title>Remove a public profile</Dialog.Title>
        <Dialog.Description size="2" mb="4">
          Paste the /people URL from the privacy request. You will confirm the
          person before anything is taken down.
        </Dialog.Description>

        <form
          onSubmit={(e) => {
            e.preventDefault()
            handleLookup()
          }}
        >
          <Flex direction="column" gap="3">
            <label>
              <Text as="div" size="2" weight="medium" mb="1">
                Profile URL or slug
              </Text>
              <TextField.Root
                {...register('query')}
                placeholder="https://goodparty.org/people/jordan-reyes-a1b2c3d4"
                color={errors.query ? 'red' : undefined}
                // A fresh URL invalidates the person already confirmed below.
                onChange={(e) => {
                  register('query').onChange(e)
                  setSubject(null)
                  setLookupError(null)
                }}
              />
              {errors.query && <ErrorText>{errors.query.message}</ErrorText>}
            </label>

            <label>
              <Text as="div" size="2" weight="medium" mb="1">
                Note (optional)
              </Text>
              <TextArea
                {...register('note')}
                placeholder="What was requested, and by whom"
              />
            </label>
          </Flex>

          {lookupError && (
            <Callout.Root color="red" mt="3">
              <Callout.Text>{lookupError}</Callout.Text>
            </Callout.Root>
          )}

          {subject && (
            <Callout.Root color="amber" mt="3">
              <Callout.Text>
                <Text as="div" weight="bold">
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
                  Their public page will stop showing any photo, bio, links or
                  issues, and will drop out of the sitemap. This is reversible.
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
                color="red"
                onClick={handleConfirm}
                disabled={isBusy}
                loading={isBusy}
              >
                Remove this profile
              </Button>
            ) : (
              <Button
                type="submit"
                disabled={!isValid || isBusy}
                loading={isBusy}
              >
                Look up
              </Button>
            )}
          </Flex>
        </form>
      </Dialog.Content>
    </Dialog.Root>
  )
}
