import { HiUsers, HiStar, HiCog, HiUserGroup } from 'react-icons/hi'
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
    title: 'Campaigns',
    href: '/dashboard/campaigns',
    icon: HiStar,
    permission: PERMISSIONS.READ_CAMPAIGNS,
  },
  {
    title: 'Members',
    href: '/dashboard/members',
    icon: HiUserGroup,
    permission: PERMISSIONS.INVITE_MEMBERS,
  },
  {
    title: 'Settings',
    href: '/dashboard/settings',
    icon: HiCog,
    permission: PERMISSIONS.MANAGE_SETTINGS,
  },
]
