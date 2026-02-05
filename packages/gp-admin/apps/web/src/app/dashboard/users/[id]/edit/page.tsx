'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { SuccessCallout } from '@/components/SuccessCallout'
import { stubbedUser } from '@/data/stubbed-user'
import { UserForm } from './components/UserForm'
import type { UserFormData } from './schema'

export default function EditUserPage() {
  const router = useRouter()
  const [saveSuccess, setSaveSuccess] = useState(false)

  function handleSave(data: UserFormData) {
    console.log('[PATCH /users/:id] Saving:', data)

    setSaveSuccess(true)
    setTimeout(() => {
      setSaveSuccess(false)
    }, 2000)
  }

  function handleCancel() {
    router.push(`/dashboard/users/${stubbedUser.id}`)
  }

  return (
    <>
      <SuccessCallout
        visible={saveSuccess}
        message="Changes saved (simulated)"
      />

      <UserForm
        initialData={stubbedUser}
        onSave={handleSave}
        onCancel={handleCancel}
      />
    </>
  )
}
