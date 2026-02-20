'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useToast } from '@/components/Toast'
import { updatePathToVictory } from '@/app/dashboard/p2v/actions'
import { P2VForm } from '../../components/P2VForm'
import type { PathToVictoryFormData } from '../../schema'
import type {
  PathToVictory,
  PathToVictoryData,
  ViabilityScore,
} from '@goodparty_org/sdk'

function toPathToVictoryData(
  formData: PathToVictoryFormData
): PathToVictoryData {
  const { viability, ...rest } = formData

  const result: PathToVictoryData = { ...rest }

  if (viability) {
    result.viability = {
      level: viability.level ?? '',
      isPartisan: viability.isPartisan ?? false,
      isIncumbent: viability.isIncumbent ?? false,
      isUncontested: viability.isUncontested ?? false,
      candidates: viability.candidates ?? 0,
      seats: viability.seats ?? 0,
      candidatesPerSeat: viability.candidatesPerSeat ?? 0,
      score: viability.score ?? 0,
      probOfWin: viability.probOfWin ?? 0,
    } satisfies ViabilityScore
  }

  return result
}

interface EditP2VClientProps {
  p2v: PathToVictory
  userId: number
}

export function EditP2VClient({ p2v, userId }: EditP2VClientProps) {
  const router = useRouter()
  const { showToast } = useToast()
  const [isSaving, setIsSaving] = useState(false)

  async function handleSave(formData: PathToVictoryFormData) {
    setIsSaving(true)
    try {
      await updatePathToVictory(p2v.id, userId, {
        data: toPathToVictoryData(formData),
      })
      showToast('Path to Victory saved')
      router.push(`/dashboard/users/${userId}/p2v`)
    } catch (error) {
      console.error('Failed to save Path to Victory:', error)
      showToast('Failed to save Path to Victory')
      throw error
    } finally {
      setIsSaving(false)
    }
  }

  function handleCancel() {
    router.push(`/dashboard/users/${userId}/p2v`)
  }

  return (
    <P2VForm
      initialData={p2v}
      onSave={handleSave}
      onCancel={handleCancel}
      isSaving={isSaving}
    />
  )
}
