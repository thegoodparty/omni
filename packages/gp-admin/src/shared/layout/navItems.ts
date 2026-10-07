import {
  HiUsers,
  HiCog,
  HiUserGroup,
  HiLightningBolt,
  HiClipboardList,
  HiChatAlt2,
  HiEyeOff,
  HiKey,
  HiStatusOnline,
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
    title: 'Agent Runs',
    href: '/dashboard/agent-runs',
    icon: HiLightningBolt,
    permission: PERMISSIONS.READ_AGENT_RUNS,
  },
  {
    title: 'SMS Outreach',
    href: '/dashboard/sms-outreach',
    icon: HiChatAlt2,
    permission: PERMISSIONS.READ_CAMPAIGNS,
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
    title: 'Domain Transfers',
    href: '/dashboard/domains',
    icon: HiKey,
    permission: PERMISSIONS.WRITE_CAMPAIGNS,
  },
  {
    title: '10DLC Status',
    href: '/dashboard/ten-dlc-status',
    icon: HiStatusOnline,
    permission: PERMISSIONS.READ_CAMPAIGNS,
  },
  {
    title: 'Settings',
    href: '/dashboard/settings',
    icon: HiCog,
    permission: PERMISSIONS.MANAGE_SETTINGS,
  },
]
