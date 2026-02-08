'use client'

import { useRouter } from 'next/navigation'
import { useToast } from '@/components/Toast'
import { useUser } from '../context/UserContext'
import { UserForm } from './components/UserForm'
import type { UserFormData } from './schema'

export default function EditUserPage() {
  const router = useRouter()
  const { showToast } = useToast()
  const user = useUser()

  function handleSave(data: UserFormData) {
    console.log('[PATCH /users/:id] Saving:', data)
    showToast('Changes saved (simulated)')
  }

  function handleCancel() {
    router.push(`/dashboard/users/${user.id}`)
  }

  return (
    <UserForm initialData={user} onSave={handleSave} onCancel={handleCancel} />
  )
}
