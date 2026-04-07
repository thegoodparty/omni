'use client'

import { useState } from 'react'
import { useClerk } from '@clerk/nextjs'
import { Button } from '@radix-ui/themes'
import { HiUsers } from 'react-icons/hi'
import { ProtectedContent } from '@/components/ProtectedContent'
import { PERMISSIONS } from '@/lib/permissions'
import { useToast } from '@/components/Toast'
import { createImpersonationToken } from '../../actions'

const GP_WEBAPP_URL =
  process.env.NEXT_PUBLIC_GP_WEBAPP_URL || 'https://app.goodparty.org'

interface ImpersonateButtonProps {
  email: string
}

export function ImpersonateButton({ email }: ImpersonateButtonProps) {
  const clerk = useClerk()
  const { showToast } = useToast()
  const [loading, setLoading] = useState(false)

  async function handleImpersonate() {
    if (!clerk.loaded) return

    setLoading(true)
    try {
      const { token } = await createImpersonationToken(email)

      await clerk.signOut()

      const result = await clerk.client.signIn.create({
        strategy: 'ticket',
        ticket: token,
      })

      if (!result.createdSessionId) {
        throw new Error('Impersonation did not create a session')
      }

      await clerk.setActive({
        session: result.createdSessionId,
        navigate: () => {
          window.location.assign(GP_WEBAPP_URL)
        },
      })
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
