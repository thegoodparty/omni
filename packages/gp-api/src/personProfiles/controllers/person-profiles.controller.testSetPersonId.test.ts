import { ForbiddenException, UnauthorizedException } from '@nestjs/common'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PersonProfilesController } from './person-profiles.controller'
import { PersonProfilesService } from '../services/person-profiles.service'
import { MarketingRevalidationService } from '../services/marketing-revalidation.service'
import { PersonIdBackfillService } from '../services/person-id-backfill.service'
import { S3Service } from '@/vendors/aws/services/s3.service'
import { UsersService } from '@/users/services/users.service'
import { User } from '../../generated/prisma'

// IS_NON_PROD_DEPLOY is a module-level constant read inside testSetPersonId.
// Mock the util so the guard is toggleable per-test via a getter. Default true
// because the unit-test env has no OTEL_SERVICE_ENVIRONMENT (so the real value
// is false) yet the happy-path cases need a non-prod deploy; other exports pass
// through untouched.
const { envNonProd } = vi.hoisted(() => ({ envNonProd: { value: true } }))
vi.mock('@/shared/util/appEnvironment.util', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@/shared/util/appEnvironment.util')>()
  return {
    ...actual,
    get IS_NON_PROD_DEPLOY() {
      return envNonProd.value
    },
  }
})

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const testUser = (overrides: Partial<User> = {}): User =>
  ({
    id: 7,
    email: 'test-42@test.goodparty.org',
    personId: null,
    ...overrides,
  }) as User

describe('testSetPersonId', () => {
  let controller: PersonProfilesController
  let users: { updateUser: ReturnType<typeof vi.fn> }

  beforeEach(() => {
    envNonProd.value = true
    users = { updateUser: vi.fn().mockResolvedValue(undefined) }
    controller = new PersonProfilesController(
      {} as unknown as PersonProfilesService,
      {} as unknown as MarketingRevalidationService,
      {} as unknown as S3Service,
      {} as unknown as PersonIdBackfillService,
      users as unknown as UsersService,
    )
  })

  it('mints a personId for a @test.goodparty.org user who has none', async () => {
    const result = await controller.testSetPersonId(testUser())

    expect(result.personId).toMatch(UUID_RE)
    expect(users.updateUser).toHaveBeenCalledWith(
      { id: 7 },
      { personId: result.personId },
    )
  })

  // Re-running a spec (or a retry) must not repoint an account that already has
  // a profile hanging off its current personId.
  it('is idempotent when the user already has a personId', async () => {
    const existing = '11111111-1111-4111-8111-111111111111'

    const result = await controller.testSetPersonId(
      testUser({ personId: existing }),
    )

    expect(result).toEqual({ personId: existing })
    expect(users.updateUser).not.toHaveBeenCalled()
  })

  it('rejects a non-@test.goodparty.org user', async () => {
    await expect(
      controller.testSetPersonId(testUser({ email: 'candidate@gmail.com' })),
    ).rejects.toBeInstanceOf(ForbiddenException)
    expect(users.updateUser).not.toHaveBeenCalled()
  })

  // User.email is non-nullable in the schema, so this is only reachable if the
  // request user arrives partially populated — which is exactly why the guard
  // uses optional chaining rather than a bare `.endsWith`.
  it('rejects a user with no email', async () => {
    await expect(
      controller.testSetPersonId(testUser({ email: undefined })),
    ).rejects.toBeInstanceOf(ForbiddenException)
    expect(users.updateUser).not.toHaveBeenCalled()
  })

  // false models prod or a misconfigured/absent OTEL_SERVICE_ENVIRONMENT, where
  // the fail-closed guard must deny rather than silently ungate.
  it('refuses outside a known non-prod deploy, even for a test user', async () => {
    envNonProd.value = false

    await expect(controller.testSetPersonId(testUser())).rejects.toBeInstanceOf(
      ForbiddenException,
    )
    expect(users.updateUser).not.toHaveBeenCalled()
  })

  // The global SessionGuard admits M2M tokens without populating request.user.
  it('rejects an M2M caller with no user', async () => {
    await expect(
      controller.testSetPersonId(undefined as unknown as User),
    ).rejects.toBeInstanceOf(UnauthorizedException)
    expect(users.updateUser).not.toHaveBeenCalled()
  })
})
