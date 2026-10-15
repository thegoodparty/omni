'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Button, Callout, Dialog, Flex, Text, TextArea } from '@radix-ui/themes'
import { useToast } from '@/components/Toast'
import { describeActionFailure } from '@/shared/util/actionFailure.util'
import { editPollQuestion } from '../actions'

interface EditQuestionActionProps {
  id: number
  question: string
}

const MIN_LENGTH = 10
const MAX_LENGTH = 480

export function EditQuestionAction({ id, question }: EditQuestionActionProps) {
  const router = useRouter()
  const { showToast } = useToast()
  const [open, setOpen] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [isRefreshing, startTransition] = useTransition()
  const busy = submitting || isRefreshing
  const [draft, setDraft] = useState(question)
  const [failure, setFailure] = useState<string | null>(null)

  const trimmed = draft.trim()
  const invalid = trimmed.length < MIN_LENGTH || trimmed.length > MAX_LENGTH

  async function handleSave() {
    if (invalid || trimmed === question) return
    setSubmitting(true)
    setFailure(null)
    try {
      const { error } = await editPollQuestion(id, trimmed)
      if (error) {
        setFailure(error)
        return
      }
      showToast('Question updated')
      setOpen(false)
      startTransition(() => router.refresh())
    } catch (error) {
      setFailure(describeActionFailure(error, 'Failed to edit question'))
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
          setDraft(question)
          setFailure(null)
        }
      }}
    >
      <Dialog.Trigger>
        <Button variant="outline" disabled={busy} loading={busy}>
          Edit question
        </Button>
      </Dialog.Trigger>
      <Dialog.Content maxWidth="560px">
        <Dialog.Title>Edit the question</Dialog.Title>
        <Dialog.Description size="2" mb="3">
          The greeting and opt-out line are added for you. This is the question
          that sends.
        </Dialog.Description>
        <TextArea
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          rows={5}
          maxLength={MAX_LENGTH}
          disabled={busy}
        />
        <Text size="1" color="gray" mt="2" as="p">
          {trimmed.length} of {MAX_LENGTH} characters. At least {MIN_LENGTH}.
        </Text>
        {failure && (
          <Callout.Root color="red" role="alert" mt="3">
            <Callout.Text>{failure}</Callout.Text>
          </Callout.Root>
        )}
        <Flex gap="3" mt="4" justify="end">
          <Dialog.Close>
            <Button variant="soft" color="gray" disabled={busy}>
              Cancel
            </Button>
          </Dialog.Close>
          <Button
            onClick={handleSave}
            disabled={busy || invalid || trimmed === question}
            loading={busy}
          >
            Save question
          </Button>
        </Flex>
      </Dialog.Content>
    </Dialog.Root>
  )
}
