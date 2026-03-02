'use client'

import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Button, Dialog, Flex, Text, TextField } from '@radix-ui/themes'
import { ErrorText } from '@/components/ErrorText'
import { FORM_MODE, INPUT_TYPE } from '@/shared/constants/form'
import { useToast } from '@/components/Toast'
import { createEcanvasser } from '../actions'

const addEcanvasserSchema = z.object({
  email: z.string().email('Invalid email address'),
  apiKey: z.string().min(1, 'API key is required'),
})

type AddEcanvasserFormData = z.infer<typeof addEcanvasserSchema>

interface AddEcanvasserDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated: () => void
}

export function AddEcanvasserDialog({
  open,
  onOpenChange,
  onCreated,
}: AddEcanvasserDialogProps) {
  const [isSaving, setIsSaving] = useState(false)
  const { showToast } = useToast()

  const {
    register,
    getValues,
    reset,
    formState: { errors, isValid },
  } = useForm<AddEcanvasserFormData>({
    mode: FORM_MODE.ON_CHANGE,
    resolver: zodResolver(addEcanvasserSchema),
    defaultValues: { email: '', apiKey: '' },
  })

  async function handleSubmit() {
    const data = getValues()
    const result = addEcanvasserSchema.safeParse(data)
    if (!result.success) return

    setIsSaving(true)
    try {
      await createEcanvasser(result.data)
      showToast('Integration added successfully')
      reset()
      onOpenChange(false)
      onCreated()
    } catch {
      showToast('Failed to add ecanvasser integration')
    } finally {
      setIsSaving(false)
    }
  }

  function handleOpenChange(nextOpen: boolean) {
    if (!nextOpen) reset()
    onOpenChange(nextOpen)
  }

  return (
    <Dialog.Root open={open} onOpenChange={handleOpenChange}>
      <Dialog.Content maxWidth="450px">
        <Dialog.Title>Add Ecanvasser Integration</Dialog.Title>
        <Dialog.Description size="2" mb="4">
          Enter the email of the campaign leader and their Ecanvasser API key.
        </Dialog.Description>

        <form
          onSubmit={(e) => {
            e.preventDefault()
            handleSubmit()
          }}
        >
          <Flex direction="column" gap="3">
            <label>
              <Text as="div" size="2" weight="medium" mb="1">
                Email
              </Text>
              <TextField.Root
                {...register('email')}
                type={INPUT_TYPE.EMAIL}
                placeholder="user@example.com"
                color={errors.email ? 'red' : undefined}
              />
              {errors.email && <ErrorText>{errors.email.message}</ErrorText>}
            </label>

            <label>
              <Text as="div" size="2" weight="medium" mb="1">
                API Key
              </Text>
              <TextField.Root
                {...register('apiKey')}
                placeholder="Ecanvasser API key"
                color={errors.apiKey ? 'red' : undefined}
              />
              {errors.apiKey && <ErrorText>{errors.apiKey.message}</ErrorText>}
            </label>
          </Flex>

          <Flex gap="3" mt="4" justify="end">
            <Dialog.Close>
              <Button
                type="button"
                variant="soft"
                color="gray"
                disabled={isSaving}
              >
                Cancel
              </Button>
            </Dialog.Close>
            <Button
              type="submit"
              disabled={!isValid || isSaving}
              loading={isSaving}
            >
              Add
            </Button>
          </Flex>
        </form>
      </Dialog.Content>
    </Dialog.Root>
  )
}
