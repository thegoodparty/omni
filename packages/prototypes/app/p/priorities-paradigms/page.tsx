'use client'

import {
  CalendarClock,
  FolderOpen,
  Gavel,
  ListOrdered,
  ShieldCheck,
  Sparkles,
  Target,
} from 'lucide-react'
import { AppShell, type ShellOrg } from '@/shared/AppShell'
import { StepperToday } from './screens/StepperToday'
import { Dossier } from './screens/Dossier'
import { Gates } from './screens/Gates'
import { CheckIn } from './screens/CheckIn'
import { NextAction } from './screens/NextAction'
import { Capability } from './screens/Capability'
import { OrdinancesContext } from './screens/OrdinancesContext'

const tabs = [
  {
    slug: 'stepper',
    label: '1. Stepper (today)',
    icon: ListOrdered,
    component: <StepperToday />,
  },
  {
    slug: 'dossier',
    label: '2. Dossier',
    icon: FolderOpen,
    component: <Dossier />,
  },
  {
    slug: 'gates',
    label: '3. Gates',
    icon: ShieldCheck,
    component: <Gates />,
  },
  {
    slug: 'check-in',
    label: '4. Check-in',
    icon: CalendarClock,
    component: <CheckIn />,
  },
  {
    slug: 'next-action',
    label: '5. Next action',
    icon: Target,
    component: <NextAction />,
  },
  {
    slug: 'capability',
    label: '6. Capability',
    icon: Sparkles,
    component: <Capability />,
  },
  {
    slug: 'ordinances',
    label: 'Ordinances',
    icon: Gavel,
    component: <OrdinancesContext />,
  },
]

const orgs: ShellOrg[] = [
  { id: 'serve', name: 'Maplewood City Council', isPro: false, tabs },
]

const Page = () => <AppShell userName="Carla Reyes" orgs={orgs} />

export default Page
