'use client'

import { useState } from 'react'
import { Button } from '@radix-ui/themes'
import { HiUsers } from 'react-icons/hi'
import { ProtectedContent } from '@/components/ProtectedContent'
import { PERMISSIONS } from '@/lib/permissions'
import { useToast } from '@/components/Toast'
import { createImpersonationToken } from '../../actions'

interface ImpersonateButtonProps {
  userId: number
}

export function ImpersonateButton({ userId }: ImpersonateButtonProps) {
  const { showToast } = useToast()
  const [loading, setLoading] = useState(false)

  async function handleImpersonate() {
    setLoading(true)
    try {
      const { token, webappUrl } = await createImpersonationToken(userId)
      window.open(`${webappUrl}/impersonate?__clerk_ticket=${token}`, '_blank')
      setLoading(false)
    } catch (error) {
      showToast(
        error instanceof Error ? error.message : 'Failed to impersonate user'
      )
      setLoading(false)
    }
  }

  return (
    <ProtectedContent
      requiredPermission={PERMISSIONS.IMPERSONATE_USERS}
      hideWhenUnauthorized
    >
      <Button variant="outline" onClick={handleImpersonate} disabled={loading}>
        <HiUsers className="w-4 h-4" />
        {loading ? 'Impersonating...' : 'Impersonate'}
      </Button>
    </ProtectedContent>
  )
}
