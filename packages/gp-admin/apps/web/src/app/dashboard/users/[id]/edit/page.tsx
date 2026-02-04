'use client'

import { useRouter } from 'next/navigation'
import { useForm, Resolver } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { Flex, Button, Separator, Callout } from '@radix-ui/themes'
import { HiCheck, HiX } from 'react-icons/hi'
import { useState } from 'react'
import { stubbedUser } from '@/data/stubbed-user'
import { userSchema, type UserFormData } from './schema'
import { UserForm } from './components/UserForm'
import { useUnsavedChangesWarning } from '../hooks/useUnsavedChangesWarning'

export default function EditUserPage() {
  const router = useRouter()
  const [saveSuccess, setSaveSuccess] = useState(false)

  const form = useForm<UserFormData>({
    mode: 'onChange',
    resolver: zodResolver(userSchema) as Resolver<UserFormData>,
    defaultValues: {
      firstName: stubbedUser.firstName ?? '',
      lastName: stubbedUser.lastName ?? '',
      name: stubbedUser.name ?? '',
      email: stubbedUser.email ?? '',
      phone: stubbedUser.phone ?? '',
      zip: stubbedUser.zip ?? '',
      avatar: stubbedUser.avatar ?? '',
      roles: stubbedUser.roles ?? [],
      metaData: {
        hubspotId: stubbedUser.metaData?.hubspotId ?? '',
        textNotifications: stubbedUser.metaData?.textNotifications ?? false,
      },
    },
  })

  useUnsavedChangesWarning(form.formState.isDirty)

  function handleCancel() {
    router.push(`/dashboard/users/${stubbedUser.id}`)
  }

  function handleSave() {
    const data = form.getValues()
    const result = userSchema.safeParse(data)

    if (!result.success) {
      console.error('Validation errors:', result.error)
      return
    }

    console.log('[PATCH /users/:id] Saving:', data)

    setSaveSuccess(true)
    setTimeout(() => {
      setSaveSuccess(false)
    }, 2000)
  }

  const { isDirty, isValid } = form.formState

  return (
    <>
      {saveSuccess && (
        <Callout.Root color="green" mb="4">
          <Callout.Icon>
            <HiCheck />
          </Callout.Icon>
          <Callout.Text>Changes saved (simulated)</Callout.Text>
        </Callout.Root>
      )}

      <UserForm
        register={form.register}
        errors={form.formState.errors}
        watch={form.watch}
        setValue={form.setValue}
      />

      <Separator size="4" my="6" />

      <Flex gap="3" justify="end">
        <Button
          type="button"
          variant="soft"
          color="gray"
          onClick={handleCancel}
        >
          <HiX className="w-4 h-4" />
          Cancel
        </Button>
        <Button
          type="button"
          onClick={handleSave}
          disabled={!isValid || !isDirty}
        >
          <HiCheck className="w-4 h-4" />
          Save Changes
        </Button>
      </Flex>
    </>
  )
}
