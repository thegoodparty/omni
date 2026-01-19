/**
 * Role and Permission constants for Clerk Organizations
 *
 * Organizations represent environments: Development, QA, Production
 * Roles: admin (full access), sales (campaigns + read users), read_only (view only)
 */

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
  INVITE_MEMBERS: 'org:admin_portal:invite_members',
} as const

export type Role = (typeof ROLES)[keyof typeof ROLES]
export type Permission = (typeof PERMISSIONS)[keyof typeof PERMISSIONS]

/**
 * Role Permissions Matrix:
 *
 * | Permission        | Admin | Sales | Read Only |
 * |-------------------|-------|-------|-----------|
 * | read_users        |   ✓   |   ✓   |     ✓     |
 * | write_users       |   ✓   |       |           |
 * | read_campaigns    |   ✓   |   ✓   |     ✓     |
 * | write_campaigns   |   ✓   |   ✓   |           |
 * | manage_settings   |   ✓   |       |           |
 * | invite_members    |   ✓   |       |           |
 */
