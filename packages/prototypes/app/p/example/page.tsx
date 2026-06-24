'use client'

import { LayoutDashboard, UsersRound } from 'lucide-react'
import { AppShell } from '@/shared/AppShell'
import { Overview } from './screens/Overview'
import { Contacts } from './screens/Contacts'

const tabs = [
  {
    slug: 'overview',
    label: 'Overview',
    icon: LayoutDashboard,
    component: <Overview />,
  },
  {
    slug: 'contacts',
    label: 'Contacts',
    icon: UsersRound,
    component: <Contacts />,
  },
]

const Page = () => <AppShell title="Example Prototype" tabs={tabs} />

export default Page
