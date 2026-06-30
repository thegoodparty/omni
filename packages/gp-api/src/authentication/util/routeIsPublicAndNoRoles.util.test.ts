import { ExecutionContext } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { describe, expect, it, vi } from 'vitest'
import { IS_PUBLIC_KEY } from '@/authentication/decorators/PublicAccess.decorator'
import { ROLES_KEY } from '@/authentication/decorators/Roles.decorator'
import { UserRole } from '../../generated/prisma'
import { routeIsPublicAndNoRoles } from './routeIsPublicAndNoRoles.util'

const context = {
  getHandler: () => ({}),
  getClass: () => ({}),
} as unknown as ExecutionContext

const reflectorFor = (isPublic?: boolean, roles?: UserRole[]): Reflector =>
  ({
    getAllAndOverride: vi.fn((key: string) =>
      key === IS_PUBLIC_KEY ? isPublic : key === ROLES_KEY ? roles : undefined,
    ),
  }) as unknown as Reflector

describe('routeIsPublicAndNoRoles', () => {
  it('is true for a public route with no @Roles()', () => {
    expect(
      routeIsPublicAndNoRoles(context, reflectorFor(true, undefined)),
    ).toBe(true)
  })

  it('is false for a public route that also declares roles', () => {
    expect(
      routeIsPublicAndNoRoles(context, reflectorFor(true, [UserRole.admin])),
    ).toBe(false)
  })

  it('is false for a non-public route with no roles', () => {
    expect(
      routeIsPublicAndNoRoles(context, reflectorFor(undefined, undefined)),
    ).toBe(false)
  })

  it('is false for a non-public route that declares roles', () => {
    expect(
      routeIsPublicAndNoRoles(context, reflectorFor(false, [UserRole.admin])),
    ).toBe(false)
  })
})
