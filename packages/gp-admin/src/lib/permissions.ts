export const ROLES = {
  ADMIN: 'org:admin',
  SALES: 'org:sales',
  READ_ONLY: 'org:read_only',
} as const

export const PERMISSIONS = {
  READ_USERS: 'org:admin_portal:read_users',
  WRITE_USERS: 'org:admin_portal:write_users',
  READ_CAMPAIGNS: 'org:admin_portal:read_campaigns',
  WRITE_CAMPAIGNS: 'org:admin_portal:write_campaigns',
  MANAGE_SETTINGS: 'org:admin_portal:manage_settings',
  MANAGE_INVITES: 'org:admin_portal:manage_invites',
  MANAGE_ECANVASSER: 'org:admin_portal:manage_ecanvasser',
} as const

export type Role = (typeof ROLES)[keyof typeof ROLES]
export type Permission = (typeof PERMISSIONS)[keyof typeof PERMISSIONS]
