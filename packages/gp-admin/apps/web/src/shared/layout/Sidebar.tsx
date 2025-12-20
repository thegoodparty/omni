'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { createContext, useContext, useState, ReactNode } from 'react'
import { HiUsers, HiStar, HiMenu } from 'react-icons/hi'

const navItems = [
  {
    title: 'Users',
    href: '/dashboard/users',
    icon: HiUsers,
  },
  {
    title: 'Campaigns',
    href: '/dashboard/campaigns',
    icon: HiStar,
  },
]

// Sidebar Context
type SidebarContextType = {
  isOpen: boolean
  toggle: () => void
}

const SidebarContext = createContext<SidebarContextType | null>(null)

export function useSidebar() {
  const context = useContext(SidebarContext)
  if (!context) {
    throw new Error('useSidebar must be used within SidebarProvider')
  }
  return context
}

export function SidebarProvider({ children }: { children: ReactNode }) {
  const [isOpen, setIsOpen] = useState(true)
  const toggle = () => setIsOpen((prev) => !prev)

  return (
    <SidebarContext.Provider value={{ isOpen, toggle }}>
      {children}
    </SidebarContext.Provider>
  )
}

export function SidebarTrigger() {
  const { toggle } = useSidebar()

  return (
    <button
      onClick={toggle}
      className="p-2 rounded-md hover:bg-sidebar-accent transition-colors"
      aria-label="Toggle Sidebar"
    >
      <HiMenu className="size-5" />
    </button>
  )
}

export default function Sidebar() {
  const pathname = usePathname()
  const { isOpen } = useSidebar()

  return (
    <aside
      className={`
        bg-sidebar border-r border-sidebar-border
        h-screen flex flex-col
        transition-all duration-300 ease-in-out
        ${isOpen ? 'w-64' : 'w-16'}
      `}
    >
      {/* Navigation */}
      <nav className="flex-1 p-2">
        <ul className="space-y-1">
          {navItems.map((item) => {
            const isActive = pathname.startsWith(item.href)
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  className={`
                    flex items-center gap-3 px-3 py-2 rounded-md
                    transition-colors duration-200
                    ${
                      isActive
                        ? 'bg-sidebar-accent text-sidebar-accent-foreground font-medium'
                        : 'text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground'
                    }
                    ${isOpen ? '' : 'justify-center'}
                  `}
                  title={!isOpen ? item.title : undefined}
                >
                  <item.icon className="size-5 shrink-0" />
                  <span
                    className={`
                      transition-all duration-300 overflow-hidden whitespace-nowrap
                      ${isOpen ? 'opacity-100 w-auto' : 'opacity-0 w-0'}
                    `}
                  >
                    {item.title}
                  </span>
                </Link>
              </li>
            )
          })}
        </ul>
      </nav>
    </aside>
  )
}
