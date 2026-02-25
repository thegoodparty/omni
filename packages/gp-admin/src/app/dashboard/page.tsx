import { Metadata } from 'next'
import { currentUser } from '@clerk/nextjs/server'
import { redirect } from 'next/navigation'

export const metadata: Metadata = {
  title: 'Dashboard | GP Admin',
  description: 'Dashboard',
}

export default async function Page() {
  const user = await currentUser()
  if (!user) redirect('/auth/sign-in')
  redirect('/dashboard/users')
}
