import { describe, it, expect } from 'vitest'
import { ROLES, PERMISSIONS } from './permissions'

describe('ROLES', () => {
  it('exports Clerk organization role identifiers', () => {
    expect(ROLES).toEqual({
      ADMIN: 'org:admin',
      SALES: 'org:sales',
      READ_ONLY: 'org:read_only',
    })
  })
})

describe('PERMISSIONS', () => {
  it('exports Clerk permission identifiers for admin portal features', () => {
    expect(PERMISSIONS).toEqual({
      READ_USERS: 'org:admin_portal:read_users',
      WRITE_USERS: 'org:admin_portal:write_users',
      READ_CAMPAIGNS: 'org:admin_portal:read_campaigns',
      WRITE_CAMPAIGNS: 'org:admin_portal:write_campaigns',
      MANAGE_SETTINGS: 'org:admin_portal:manage_settings',
      MANAGE_INVITES: 'org:admin_portal:manage_invites',
      MANAGE_ECANVASSER: 'org:admin_portal:manage_ecanvasser',
    })
  })
})
