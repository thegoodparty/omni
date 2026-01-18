import { redirect } from 'next/navigation'
import { auth } from '@clerk/nextjs/server'

export default async function Home() {
  const { userId } = await auth()

  if (userId) {
    // User is signed in - redirect to dashboard
    // Organization selection is handled by Clerk if needed
    redirect('/dashboard')
  } else {
    // User is not signed in - redirect to sign-in
    redirect('/auth/sign-in')
  }
}
