'use client'

import { ReactNode } from 'react'
import Sidebar from '@/shared/layout/Sidebar'

export default function DashboardLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen">
      <Sidebar />
      <div className="flex-1 flex flex-col transition-all duration-300">
        <main className="flex-1 p-4">{children}</main>
      </div>
    </div>
  )
}
