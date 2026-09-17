'use client'

import { useRouter } from 'next/navigation'
import { useToast } from '@/components/Toast'
import { updateUser } from '../../actions'
import { useUser } from '../context/UserContext'
import { UserForm } from './components/UserForm'
import type { UserFormData } from './schema'

export default function EditUserPage() {
  const router = useRouter()
  const { showToast } = useToast()
  const user = useUser()
  const { id } = user

  async function handleSave(data: UserFormData) {
    let result: Awaited<ReturnType<typeof updateUser>>
    try {
      result = await updateUser(id, data)
    } catch (error) {
      showToast('Failed to save changes', 'error')
      throw error
    }

    if ('error' in result) {
      showToast(result.error, 'error')
      throw new Error(result.error)
    }

    router.push(`/dashboard/users/${id}`)
    router.refresh()
  }

  function handleCancel() {
    router.push(`/dashboard/users/${id}`)
  }

  return (
    <UserForm initialData={user} onSave={handleSave} onCancel={handleCancel} />
  )
}
