import {
  AUTH_PROVIDER_TOKEN,
  AuthProvider,
} from '@/authentication/interfaces/auth-provider.interface'
import { useTestService } from '@/test-service'
import { PinoLogger } from 'nestjs-pino'
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type MockInstance,
} from 'vitest'
import { UserRole } from '../../generated/prisma'

const service = useTestService()

const AUDIT_MSG = 'Admin route accessed'
const MACHINE_ID = 'mch_gp_admin'
const OPERATOR = 'ops@goodparty.org'
const M2M_HEADERS = { Authorization: 'Bearer mt_test' }

describe('AdminAuditInterceptor', () => {
  let info: MockInstance<PinoLogger['info']>
  let verifyM2MToken: MockInstance<AuthProvider['verifyM2MToken']>

  beforeEach(() => {
    info = vi.spyOn(PinoLogger.prototype, 'info')
    // SessionGuard only sets req.m2mToken for an mt_ bearer it can verify,
    // and the harness authenticates as a session user by default.
    verifyM2MToken = vi
      .spyOn(
        service.app.get<AuthProvider>(AUTH_PROVIDER_TOKEN),
        'verifyM2MToken',
      )
      .mockResolvedValue({ id: 'mt_test', subject: MACHINE_ID })
  })

  // Restore only these spies: the harness installs its own mocks to
  // authenticate the test client, and a blanket restore logs it out.
  afterEach(() => {
    info.mockRestore()
    verifyM2MToken.mockRestore()
  })

  describe('machine callers', () => {
    it('records the machine and the staff member it named', async () => {
      await service.prisma.organization.create({
        data: { slug: 'audit-org', ownerId: service.user.id },
      })

      const res = await service.client.patch(
        '/v1/organizations/admin/audit-org',
        { customPositionName: 'Mayor', actorEmail: OPERATOR },
        { headers: M2M_HEADERS },
      )

      expect(res.status).toBe(200)
      expect(info).toHaveBeenCalledWith(
        expect.objectContaining({
          msg: AUDIT_MSG,
          authSource: 'm2m',
          machineId: MACHINE_ID,
          suppliedActorEmail: OPERATOR,
          endpoint: '/v1/organizations/admin/audit-org',
          httpMethod: 'PATCH',
          body: { customPositionName: 'Mayor', actorEmail: OPERATOR },
        }),
      )
    })

    it('reads a staff member named in the query string', async () => {
      const res = await service.client.get('/v1/admin/users/search', {
        params: { email: 'tests', actorEmail: OPERATOR },
        headers: M2M_HEADERS,
      })

      expect(res.status).toBe(200)
      expect(info).toHaveBeenCalledWith(
        expect.objectContaining({
          msg: AUDIT_MSG,
          machineId: MACHINE_ID,
          suppliedActorEmail: OPERATOR,
          httpMethod: 'GET',
        }),
      )
    })

    it('records a null actor when the caller names nobody', async () => {
      const res = await service.client.get('/v1/admin/users/search', {
        params: { email: 'tests' },
        headers: M2M_HEADERS,
      })

      expect(res.status).toBe(200)
      expect(info).toHaveBeenCalledWith(
        expect.objectContaining({
          msg: AUDIT_MSG,
          machineId: MACHINE_ID,
          suppliedActorEmail: null,
        }),
      )
    })
  })

  describe('staff sessions', () => {
    beforeEach(() =>
      service.prisma.user.update({
        where: { id: service.user.id },
        data: { roles: [UserRole.admin] },
      }),
    )

    it('records the admin on a @Roles(admin) route', async () => {
      const res = await service.client.get(`/v1/admin/users/${service.user.id}`)

      expect(res.status).toBe(200)
      expect(info).toHaveBeenCalledWith(
        expect.objectContaining({
          msg: AUDIT_MSG,
          authSource: 'session',
          userId: service.user.id,
          userEmail: service.user.email,
          endpoint: `/v1/admin/users/${service.user.id}`,
          httpMethod: 'GET',
          requiredRoles: [UserRole.admin],
        }),
      )
      expect(info).not.toHaveBeenCalledWith(
        expect.objectContaining({ msg: AUDIT_MSG, authSource: 'm2m' }),
      )
    })

    it('records the admin on a route machines can also call', async () => {
      const res = await service.client.get('/v1/admin/users/search', {
        params: { email: 'tests' },
      })

      expect(res.status).toBe(200)
      expect(info).toHaveBeenCalledWith(
        expect.objectContaining({
          msg: AUDIT_MSG,
          authSource: 'session',
          userId: service.user.id,
        }),
      )
    })
  })

  it('does not record a route that is not admin-gated', async () => {
    const res = await service.client.get('/v1/users/me')

    expect(res.status).toBe(200)
    expect(info).not.toHaveBeenCalledWith(
      expect.objectContaining({ msg: AUDIT_MSG }),
    )
  })
})
