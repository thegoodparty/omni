'use client'

import { Sparkles } from 'lucide-react'
import { AppShell, type ShellOrg } from '@/shared/AppShell'
import { Workspace } from './components/Workspace'

// One tab on purpose. The whole prototype is that the chat and the file are two
// views of one thread, so putting them behind separate nav entries would argue
// the opposite, and a tab switch would reset the demo mid-sentence.
const orgs: ShellOrg[] = [
  {
    id: 'serve',
    name: 'Maplewood City Council',
    isPro: false,
    tabs: [
      {
        slug: 'chief-of-staff',
        label: 'Chief of Staff',
        icon: Sparkles,
        component: <Workspace />,
      },
    ],
  },
]

const Page = () => <AppShell userName="Carla Reyes" orgs={orgs} />

export default Page
