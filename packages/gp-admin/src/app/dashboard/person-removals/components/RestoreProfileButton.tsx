'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@radix-ui/themes'
import { HiOutlineReply } from 'react-icons/hi'
import { useToast } from '@/components/Toast'
import { restorePersonProfile } from '../actions'

interface RestoreProfileButtonProps {
  personId: string
}

export function RestoreProfileButton({ personId }: RestoreProfileButtonProps) {
  const router = useRouter()
  const { showToast } = useToast()
  const [isSaving, setIsSaving] = useState(false)

  async function handleRestore() {
    setIsSaving(true)
    try {
      await restorePersonProfile(personId)
      showToast('Profile restored')
      router.refresh()
    } catch (error) {
      showToast(
        error instanceof Error ? error.message : 'Failed to restore profile'
      )
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <Button
      variant="outline"
      onClick={handleRestore}
      disabled={isSaving}
      loading={isSaving}
    >
      <HiOutlineReply className="w-4 h-4" />
      Undo
    </Button>
  )
}
