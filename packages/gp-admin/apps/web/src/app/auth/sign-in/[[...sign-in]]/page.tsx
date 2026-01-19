import { SignIn } from '@clerk/nextjs'
import { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Sign In | GP Admin',
  description: 'Sign in to your GP Admin account',
}

export default function SignInPage() {
  return (
    <div className="flex items-center justify-center min-h-[calc(100vh-64px)]">
      <div className="p-8">
        <div className="flex flex-col items-center justify-center">
          <SignIn />
        </div>
      </div>
    </div>
  )
}
