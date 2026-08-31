import { Suspense } from 'react'
import SignInLinkContent from './SignInLinkContent'

export default function SignInLinkPage() {
  return (
    <Suspense fallback={<div>Loading your sign-in link…</div>}>
      <SignInLinkContent />
    </Suspense>
  )
}
