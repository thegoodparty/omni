import { describe, it, expect } from 'vitest'
import { ROLES, PERMISSIONS } from './permissions'

describe('ROLES', () => {
  it('should have ADMIN role', () => {
    expect(ROLES.ADMIN).toBe('org:admin')
  })

  it('should have SALES role', () => {
    expect(ROLES.SALES).toBe('org:sales')
  })

  it('should have READ_ONLY role', () => {
    expect(ROLES.READ_ONLY).toBe('org:read_only')
  })

  it('should have exactly 3 roles', () => {
    expect(Object.keys(ROLES)).toHaveLength(3)
  })
})

describe('PERMISSIONS', () => {
  it('should have READ_USERS permission', () => {
    expect(PERMISSIONS.READ_USERS).toBe('org:admin_portal:read_users')
  })

  it('should have WRITE_USERS permission', () => {
    expect(PERMISSIONS.WRITE_USERS).toBe('org:admin_portal:write_users')
  })

  it('should have READ_CAMPAIGNS permission', () => {
    expect(PERMISSIONS.READ_CAMPAIGNS).toBe('org:admin_portal:read_campaigns')
  })

  it('should have WRITE_CAMPAIGNS permission', () => {
    expect(PERMISSIONS.WRITE_CAMPAIGNS).toBe('org:admin_portal:write_campaigns')
  })

  it('should have MANAGE_SETTINGS permission', () => {
    expect(PERMISSIONS.MANAGE_SETTINGS).toBe('org:admin_portal:manage_settings')
  })

  it('should have MANAGE_INVITES permission', () => {
    expect(PERMISSIONS.MANAGE_INVITES).toBe('org:admin_portal:manage_invites')
  })

  it('should have exactly 6 permissions', () => {
    expect(Object.keys(PERMISSIONS)).toHaveLength(6)
  })
})
