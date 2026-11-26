import type { ReactNode } from 'react'
import { caveat, plexMono } from 'app/fonts'

// The warm welcome's folder is drawn with two faces nothing else uses. They
// are made available here, around the onboarding route only, so no other
// page loads them.
export default function ServeOnboardingLayout({
  children,
}: {
  children: ReactNode
}): React.JSX.Element {
  return (
    <div className={`${caveat.variable} ${plexMono.variable} contents`}>
      {children}
    </div>
  )
}
