import { ReactNode } from 'react'
import { DashboardShell } from './components/DashboardShell'

export default async function DashboardLayout({
  children,
}: {
  children: ReactNode
}) {
  return <DashboardShell>{children}</DashboardShell>
}
