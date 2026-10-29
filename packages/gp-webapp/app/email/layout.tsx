import { ReactNode } from 'react'

export default function EmailPublicLayout({
  children,
}: {
  children: ReactNode
}) {
  return (
    <div className="min-h-screen bg-muted">
      <main className="mx-auto flex max-w-md flex-col gap-6 px-4 py-16">
        {children}
      </main>
    </div>
  )
}
