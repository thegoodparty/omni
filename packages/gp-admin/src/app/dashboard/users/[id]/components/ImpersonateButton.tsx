'use client'

import { useState } from 'react'
import { Badge, Button, Flex } from '@radix-ui/themes'
import { HiUsers } from 'react-icons/hi'
import { ProtectedContent } from '@/components/ProtectedContent'
import { PERMISSIONS } from '@/lib/permissions'
import { useToast } from '@/components/Toast'
import { useClerkBanStatus } from '../context/UserContext'
import { createImpersonationToken } from '../../actions'

interface ImpersonateButtonProps {
  userId: number
}

export function ImpersonateButton({ userId }: ImpersonateButtonProps) {
  const { showToast } = useToast()
  const clerkBanned = useClerkBanStatus()
  const [loading, setLoading] = useState(false)

  async function handleImpersonate() {
    setLoading(true)
    try {
      const { token, webappUrl, error } = await createImpersonationToken(userId)
      if (error || !token) {
        showToast(error ?? 'Failed to impersonate user')
        return
      }
      window.open(`${webappUrl}/impersonate?__clerk_ticket=${token}`, '_blank')
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
      <Flex gap="2" align="center">
        {clerkBanned && (
          <Badge
            color="red"
            title="Clerk bans this account, so an impersonation session cannot be created"
          >
            Banned in Clerk
          </Badge>
        )}
        <Button
          variant="outline"
          onClick={handleImpersonate}
          disabled={loading || clerkBanned}
        >
          <HiUsers className="w-4 h-4" />
          {loading ? 'Impersonating...' : 'Impersonate'}
        </Button>
      </Flex>
    </ProtectedContent>
  )
}
