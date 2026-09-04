import type { ReactNode } from 'react'

// Parallel-slot layout so the door-knocking modal can render alongside the
// hub without swapping the whole route. See the @dk slot below.
export default function OutreachLayout({
  children,
  dk,
}: {
  children: ReactNode
  dk: ReactNode
}) {
  return (
    <>
      {children}
      {dk}
    </>
  )
}
