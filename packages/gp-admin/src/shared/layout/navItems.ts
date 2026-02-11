import { HiUsers, HiCog, HiUserGroup } from 'react-icons/hi'
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
    title: 'Settings',
    href: '/dashboard/settings',
    icon: HiCog,
    permission: PERMISSIONS.MANAGE_SETTINGS,
  },
]
