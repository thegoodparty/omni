'use client'

import { useState } from 'react'
import { useSignIn } from '@clerk/nextjs'
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
  const { signIn, setActive } = useSignIn()
  const { showToast } = useToast()
  const [loading, setLoading] = useState(false)

  async function handleImpersonate() {
    if (!signIn || !setActive) return

    setLoading(true)
    try {
      const { token } = await createImpersonationToken(email)

      const result = await signIn.create({
        strategy: 'ticket',
        ticket: token,
      })

      await setActive({ session: result.createdSessionId })
      window.location.href = GP_WEBAPP_URL
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
