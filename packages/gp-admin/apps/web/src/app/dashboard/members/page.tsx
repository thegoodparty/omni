import { auth } from '@clerk/nextjs/server'
import { redirect } from 'next/navigation'
import { ROLES } from '@/lib/permissions'
import { MembersPage } from './components/MembersPage'
import { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Members | GP Admin',
  description: 'Manage organization members',
}

export default async function Page() {
  const { has, orgId } = await auth()

  if (!has?.({ role: ROLES.ADMIN })) {
    redirect('/dashboard')
  }

  if (!orgId) {
    redirect('/dashboard')
  }

  return <MembersPage />
}
