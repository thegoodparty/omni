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

  // Check if we're NOT in production:
  // - On Vercel: use VERCEL_ENV (preview deployments have NODE_ENV=production but VERCEL_ENV=preview)
  // - Locally: use NODE_ENV
  const isNotProductionEnv = process.env.VERCEL_ENV
    ? process.env.VERCEL_ENV !== 'production'
    : process.env.NODE_ENV !== 'production'

  const isE2ETesting =
    isNotProductionEnv &&
    process.env.NEXT_PUBLIC_E2E_TESTING === 'true' &&
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
