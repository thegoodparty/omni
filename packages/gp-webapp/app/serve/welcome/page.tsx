import { Suspense } from 'react'
import ServeWelcomeContent from './ServeWelcomeContent'

export default function ServeWelcomePage() {
  return (
    <Suspense fallback={<div>Setting up your account…</div>}>
      <ServeWelcomeContent />
    </Suspense>
  )
}
