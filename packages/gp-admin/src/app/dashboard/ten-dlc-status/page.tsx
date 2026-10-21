import { Metadata } from 'next'
import { ProtectedContent } from '@/components/ProtectedContent'
import { PERMISSIONS } from '@/lib/permissions'
import { TenDlcStatusPage } from './components/TenDlcStatusPage'

export const metadata: Metadata = {
  title: '10DLC Status | GP Admin',
  description: 'Triage, override, and repair stuck 10DLC registrations',
}

export default function Page() {
  return (
    <ProtectedContent requiredPermission={PERMISSIONS.READ_CAMPAIGNS}>
      <TenDlcStatusPage />
    </ProtectedContent>
  )
}
