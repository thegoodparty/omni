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
    try {
      await updateUser(id, {
        firstName: data.firstName,
        lastName: data.lastName,
        name: data.name,
        email: data.email,
        phone: data.phone,
        zip: data.zip,
        roles: data.roles,
        metaData: {
          hubspotId: data.metaData?.hubspotId,
          textNotifications: data.metaData?.textNotifications ?? false,
        },
      })

      router.push(`/dashboard/users/${id}`)
    } catch (error) {
      showToast('Failed to save changes')
      throw error
    }
  }

  function handleCancel() {
    router.push(`/dashboard/users/${id}`)
  }

  return (
    <UserForm initialData={user} onSave={handleSave} onCancel={handleCancel} />
  )
}
