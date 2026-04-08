'use client'

import { useState } from 'react'
import { Button } from '@radix-ui/themes'
import { HiUsers } from 'react-icons/hi'
import { ProtectedContent } from '@/components/ProtectedContent'
import { PERMISSIONS } from '@/lib/permissions'
import { useToast } from '@/components/Toast'
import { createImpersonationToken } from '../../actions'

const GP_WEBAPP_URL =
  process.env.NEXT_PUBLIC_GP_WEBAPP_URL || 'https://app.goodparty.org'

interface ImpersonateButtonProps {
  userId: number
}

export function ImpersonateButton({ userId }: ImpersonateButtonProps) {
  const { showToast } = useToast()
  const [loading, setLoading] = useState(false)

  async function handleImpersonate() {
    setLoading(true)
    try {
      const { token } = await createImpersonationToken(userId)
      window.location.assign(
        `${GP_WEBAPP_URL}/impersonate?__clerk_ticket=${token}`
      )
    } catch (error) {
      showToast(
        error instanceof Error ? error.message : 'Failed to impersonate user'
      )
    } finally {
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
