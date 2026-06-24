import { Suspense } from 'react'
import WinWelcomeContent from './WinWelcomeContent'

export default function WinWelcomePage() {
  return (
    <Suspense fallback={<div>Setting up your account…</div>}>
      <WinWelcomeContent />
    </Suspense>
  )
}
