import { SignIn } from '@clerk/nextjs'
import { Metadata } from 'next'
import Image from 'next/image'

export const metadata: Metadata = {
  title: 'Sign In | GP Admin',
  description: 'Sign in to your GP Admin account',
}

export default function SignInPage() {
  return (
    <div className="flex min-h-screen items-center justify-center">
      <div className="w-full max-w-lg flex flex-col items-center justify-center p-8 ">
        <SignIn />
      </div>
    </div>
  )
}
