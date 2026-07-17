'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useCrmEnabled } from '../../../shared/useCrmEnabled'
import ListDetailPage from './ListDetailPage'

interface ListDetailPageGateProps {
  listId: string
}

// The list-detail route only exists for the CRM surface — there's no legacy
// equivalent to fall back to (root CLAUDE.md gate). trackExposure=false:
// the whole-page gate on /dashboard/contacts already fires the win-crm /
// serve-crm exposure; a user reaching this URL has already been counted.
export default function ListDetailPageGate({
  listId,
}: ListDetailPageGateProps) {
  const router = useRouter()
  const { enabled, ready } = useCrmEnabled(false)

  useEffect(() => {
    if (ready && !enabled) {
      router.replace('/dashboard/contacts')
    }
  }, [ready, enabled, router])

  if (!ready || !enabled) {
    return null
  }

  return <ListDetailPage listId={listId} />
}
