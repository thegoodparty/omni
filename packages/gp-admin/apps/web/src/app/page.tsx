import { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { currentUser } from '@clerk/nextjs/server'
import { cookies } from 'next/headers'

export const metadata: Metadata = {
  title: 'GP Admin',
  description: 'GP Admin',
}

export default async function Home() {
  const cookieStore = await cookies()
  const isE2ETesting =
    process.env.NEXT_PUBLIC_E2E_TESTING === 'true' ||
    cookieStore.get('__e2e_bypass')?.value === 'true'

  if (isE2ETesting) {
    return redirect('/dashboard')
  }

  const user = await currentUser()
  if (user) {
    return redirect('/dashboard')
  } else {
    return redirect('/auth/sign-in')
  }
}
