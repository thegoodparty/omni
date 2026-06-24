'use client'

import {
  Sparkles,
  Calendar,
  Flag,
  UsersRound,
  MessageSquare,
  Landmark,
  Gavel,
  Globe,
  LayoutDashboard,
  Send,
  Bot,
  FileText,
} from 'lucide-react'
import { AppShell, type ShellMode } from '@/shared/AppShell'
import { Overview } from './screens/Overview'
import { Contacts } from './screens/Contacts'
import { Placeholder } from './screens/Placeholder'

const serveTabs = [
  {
    slug: 'chief-of-staff',
    label: 'Chief of Staff',
    icon: Sparkles,
    component: (
      <Placeholder
        title="Chief of Staff"
        blurb="Your AI chief of staff for the office."
      />
    ),
  },
  {
    slug: 'calendar',
    label: 'Calendar',
    icon: Calendar,
    component: (
      <Placeholder title="Calendar" blurb="Upcoming meetings and events." />
    ),
  },
  {
    slug: 'community-issues',
    label: 'Community Issues',
    icon: Flag,
    component: <Overview />,
  },
  {
    slug: 'constituent-data',
    label: 'Constituent Data',
    icon: UsersRound,
    component: <Contacts />,
  },
  {
    slug: 'communications',
    label: 'Communications',
    icon: MessageSquare,
    component: (
      <Placeholder
        title="Communications"
        blurb="Constituent outreach and messaging."
      />
    ),
  },
  {
    slug: 'budget',
    label: 'Budget',
    icon: Landmark,
    component: (
      <Placeholder title="Budget" blurb="Town budget and appropriations." />
    ),
  },
  {
    slug: 'ordinances',
    label: 'Ordinances',
    icon: Gavel,
    component: (
      <Placeholder title="Ordinances" blurb="Drafts and voting records." />
    ),
  },
  {
    slug: 'public-profile',
    label: 'Public Profile',
    icon: Globe,
    component: (
      <Placeholder
        title="Public Profile"
        blurb="Your public-facing official page."
      />
    ),
  },
]

const winTabs = [
  {
    slug: 'campaign-manager',
    label: 'Campaign Manager',
    icon: LayoutDashboard,
    component: <Overview />,
  },
  {
    slug: 'voter-outreach',
    label: 'Voter Outreach',
    icon: Send,
    component: (
      <Placeholder title="Voter Outreach" blurb="Canvassing and texting." />
    ),
  },
  {
    slug: 'voter-data',
    label: 'Voter Data',
    icon: UsersRound,
    component: <Contacts />,
  },
  {
    slug: 'website',
    label: 'Website',
    icon: Globe,
    component: (
      <Placeholder title="Website" blurb="Your campaign website builder." />
    ),
  },
  {
    slug: 'ai-assistant',
    label: 'AI Assistant',
    icon: Bot,
    component: (
      <Placeholder title="AI Assistant" blurb="Draft content with AI." />
    ),
  },
  {
    slug: 'content-builder',
    label: 'Content Builder',
    icon: FileText,
    component: (
      <Placeholder title="Content Builder" blurb="Posts, emails, and more." />
    ),
  },
]

const modes: ShellMode[] = [
  {
    id: 'serve',
    label: 'Serve',
    role: 'Serve – City Council',
    tabs: serveTabs,
  },
  { id: 'win', label: 'Win', role: 'Win – 2026 Campaign', tabs: winTabs },
]

const Page = () => <AppShell userName="Renee Wells" modes={modes} />

export default Page
