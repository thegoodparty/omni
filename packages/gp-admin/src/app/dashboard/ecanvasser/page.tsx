import { auth } from '@clerk/nextjs/server'
import { redirect } from 'next/navigation'
import { PERMISSIONS } from '@/lib/permissions'
import { EcanvasserPage } from './components/EcanvasserPage'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Ecanvasser | GP Admin',
  description: 'Manage ecanvasser integrations',
}

export default async function Page() {
  const { has, orgId } = await auth()

  if (!has?.({ permission: PERMISSIONS.MANAGE_ECANVASSER }) || !orgId) {
    redirect('/dashboard/users')
  }

  return <EcanvasserPage />
}
