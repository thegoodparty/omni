import {
  HiUsers,
  HiCog,
  HiUserGroup,
  HiGlobeAlt,
  HiLightningBolt,
  HiClipboardList,
  HiEyeOff,
} from 'react-icons/hi'
import { PERMISSIONS, Permission } from '@/lib/permissions'
import { IconType } from 'react-icons'

export interface NavItem {
  title: string
  href: string
  icon: IconType
  permission: Permission
}

export const navItems: NavItem[] = [
  {
    title: 'Users',
    href: '/dashboard/users',
    icon: HiUsers,
    permission: PERMISSIONS.READ_USERS,
  },
  {
    title: 'Members (Internal)',
    href: '/dashboard/members',
    icon: HiUserGroup,
    permission: PERMISSIONS.MANAGE_INVITES,
  },
  {
    title: 'Ecanvasser',
    href: '/dashboard/ecanvasser',
    icon: HiGlobeAlt,
    permission: PERMISSIONS.MANAGE_ECANVASSER,
  },
  {
    title: 'Agent Runs',
    href: '/dashboard/agent-runs',
    icon: HiLightningBolt,
    permission: PERMISSIONS.READ_AGENT_RUNS,
  },
  {
    title: 'Briefings',
    href: '/dashboard/briefings',
    icon: HiClipboardList,
    permission: PERMISSIONS.REVIEW_BRIEFINGS,
  },
  {
    title: 'Profile Removals',
    href: '/dashboard/person-removals',
    icon: HiEyeOff,
    permission: PERMISSIONS.MANAGE_PERSON_REMOVALS,
  },
  {
    title: 'Settings',
    href: '/dashboard/settings',
    icon: HiCog,
    permission: PERMISSIONS.MANAGE_SETTINGS,
  },
]
