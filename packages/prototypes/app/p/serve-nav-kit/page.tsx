'use client'

import {
  LayoutDashboard,
  FileText,
  Send,
  DoorOpen,
  UsersRound,
  HandCoins,
  BookOpen,
  Swords,
  Globe,
} from 'lucide-react'
import { AppShell, type ShellOrg } from '@/shared/AppShell'
import { AppToaster } from './components/AppToaster'
import { CampaignManager } from './screens/CampaignManager'
import { OutreachScreen } from './screens/OutreachScreen'
import { DoorKnocking } from './screens/DoorKnocking'
import { CampaignTracker } from './screens/CampaignTracker'
import { VoterData } from './screens/VoterData'
import { Fundraising } from './screens/Fundraising'
import { YourStory } from './screens/YourStory'
import { KnowYourOpponent } from './screens/KnowYourOpponent'
import { PublicProfile } from './screens/PublicProfile'

const winTabs = [
  {
    slug: 'campaign-manager',
    label: 'Campaign Manager',
    icon: LayoutDashboard,
    component: <CampaignManager />,
  },
  {
    slug: 'campaign-tracker',
    label: 'Campaign Tracker',
    icon: FileText,
    component: <CampaignTracker />,
  },
  {
    slug: 'voter-outreach',
    label: 'Voter Outreach',
    icon: Send,
    component: (
      <OutreachScreen
        title="Voter Outreach"
        aiPlaceholder="Draft a campaign or ask about your outreach…"
      />
    ),
  },
  {
    slug: 'door-knocking',
    label: 'Door Knocking',
    icon: DoorOpen,
    component: (
      <DoorKnocking
        title="Door Knocking"
        aiPlaceholder="Ask about your turf, routes, or canvassing…"
      />
    ),
  },
  {
    slug: 'voter-data',
    label: 'Voter Data',
    icon: UsersRound,
    component: <VoterData />,
  },
  {
    slug: 'fundraising',
    label: 'Fundraising',
    icon: HandCoins,
    component: <Fundraising />,
  },
  {
    slug: 'your-story',
    label: 'Your Story',
    icon: BookOpen,
    component: <YourStory />,
  },
  {
    slug: 'know-your-opponent',
    label: 'Know Your Opponent',
    icon: Swords,
    component: <KnowYourOpponent />,
  },
  {
    slug: 'public-profile',
    label: 'Public Profile',
    icon: Globe,
    component: <PublicProfile />,
  },
]

const orgs: ShellOrg[] = [
  { id: 'win', name: '2026 Campaign', isPro: true, tabs: winTabs },
]

const Page = () => (
  <>
    <AppShell userName="Renee Wells" orgs={orgs} />
    <AppToaster />
  </>
)

export default Page
