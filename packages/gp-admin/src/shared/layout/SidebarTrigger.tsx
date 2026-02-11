'use client'

import { HiMenu } from 'react-icons/hi'
import { IconButton } from '@radix-ui/themes'
import { useSidebar } from './SidebarContext'

export function SidebarTrigger() {
  const { toggle } = useSidebar()

  return (
    <IconButton variant="ghost" onClick={toggle} aria-label="Toggle Sidebar">
      <HiMenu className="w-5 h-5" />
    </IconButton>
  )
}
