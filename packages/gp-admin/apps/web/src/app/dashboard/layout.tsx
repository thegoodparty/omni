'use client'

import { ReactNode } from 'react'
import Sidebar from '@/shared/layout/Sidebar'
import { OrganizationRequired } from '@/components/OrganizationRequired'

export default function DashboardLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-[calc(100vh-64px)]">
      <Sidebar />
      <div className="flex flex-col flex-1 transition-all duration-300">
        <main className="flex-1 p-4">
          <OrganizationRequired>{children}</OrganizationRequired>
        </main>
      </div>
    </div>
  )
}
