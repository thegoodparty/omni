import { auth } from '@clerk/nextjs/server'
import { redirect } from 'next/navigation'
import { ReactNode } from 'react'
import { DashboardShell } from './components/DashboardShell'

export default async function DashboardLayout({
  children,
}: {
  children: ReactNode
}) {
  const { userId } = await auth()

  if (!userId) {
    redirect('/auth/sign-in')
  }

  return <DashboardShell>{children}</DashboardShell>
}
