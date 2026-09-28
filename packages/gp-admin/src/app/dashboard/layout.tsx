import { ReactNode } from 'react'
import { DashboardShell } from './components/DashboardShell'
import { EnvironmentGate } from '@/components/EnvironmentGate'

export default async function DashboardLayout({
  children,
}: {
  children: ReactNode
}) {
  return (
    <DashboardShell>
      <EnvironmentGate>{children}</EnvironmentGate>
    </DashboardShell>
  )
}
