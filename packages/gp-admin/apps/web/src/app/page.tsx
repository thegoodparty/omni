import { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { currentUser } from '@clerk/nextjs/server'

export const metadata: Metadata = {
  title: 'GP Admin',
  description: 'GP Admin',
}

export default async function Home() {
  const user = await currentUser()
  if (user) {
    return redirect('/dashboard')
  } else {
    return redirect('/auth/sign-in')
  }
}
