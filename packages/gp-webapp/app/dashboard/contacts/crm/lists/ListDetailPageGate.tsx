'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useCrmEnabled } from '../../../shared/useCrmEnabled'
import DashboardLayout from '../../../shared/DashboardLayout'
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

  // Still settling: there's no loading.tsx for this route, so without this
  // the user would sit on a blank page (no layout, no spinner) until the
  // Win/Serve mode + flag reads resolve.
  if (!ready) {
    return (
      <DashboardLayout>
        <p className="p-6 text-sm text-muted-foreground">Loading…</p>
      </DashboardLayout>
    )
  }

  // Settled and disabled: the redirect effect above is already firing —
  // keep the loading UI visible while navigation completes so the user
  // never sees a blank layout.
  if (!enabled) {
    return (
      <DashboardLayout>
        <p className="p-6 text-sm text-muted-foreground">Loading…</p>
      </DashboardLayout>
    )
  }

  return <ListDetailPage listId={listId} />
}
