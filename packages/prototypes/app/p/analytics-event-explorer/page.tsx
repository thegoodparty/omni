'use client'

import { Search } from 'lucide-react'
import { AppShell, type ShellOrg } from '@/shared/AppShell'
import { Explore } from './screens/Explore'

// One org, one tab: this is an internal tool, not a candidate workspace, and the whole
// design is a single searchable surface rather than a set of screens. The shell is here
// only so the page wears the same chrome as the product.
const orgs: ShellOrg[] = [
  {
    id: 'product-analytics',
    name: 'Product Analytics',
    isPro: false,
    tabs: [
      {
        slug: 'explore',
        label: 'Explore',
        icon: Search,
        component: <Explore />,
      },
    ],
  },
]

const Page = () => <AppShell userName="Nate Allen" orgs={orgs} />

export default Page
