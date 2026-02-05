'use client'

import { useRouter } from 'next/navigation'
import { useToast } from '@/components/Toast'
import { stubbedUser } from '@/data/stubbed-user'
import { UserForm } from './components/UserForm'
import type { UserFormData } from './schema'

export default function EditUserPage() {
  const router = useRouter()
  const { showToast } = useToast()

  function handleSave(data: UserFormData) {
    console.log('[PATCH /users/:id] Saving:', data)
    showToast('Changes saved (simulated)')
  }

  function handleCancel() {
    router.push(`/dashboard/users/${stubbedUser.id}`)
  }

  return (
    <UserForm
      initialData={stubbedUser}
      onSave={handleSave}
      onCancel={handleCancel}
    />
  )
}
