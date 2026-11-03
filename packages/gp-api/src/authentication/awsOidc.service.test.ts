import { Controller, Get, UseGuards } from '@nestjs/common'
import { APP_GUARD } from '@nestjs/core'
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify'
import { Test } from '@nestjs/testing'
import {
  exportJWK,
  generateKeyPair,
  GenerateKeyPairResult,
  SignJWT,
} from 'jose'
import { PinoLogger } from 'nestjs-pino'
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest'
import { AgentMcpMarker } from '@/authentication/agentMcpMarker'
import { AwsOidcService } from '@/authentication/awsOidc.service'
import { PublicAccess } from '@/authentication/decorators/PublicAccess.decorator'
import { AdminOrM2MGuard } from '@/authentication/guards/AdminOrM2M.guard'
import { HandoffAgentGuard } from '@/authentication/guards/HandoffAgent.guard'
import { M2MOnly } from '@/authentication/guards/M2MOnly.guard'
import { ServiceReadGuard } from '@/authentication/guards/ServiceRead.guard'
import { SessionGuard } from '@/authentication/guards/Session.guard'
import { AUTH_PROVIDER_TOKEN } from '@/authentication/interfaces/auth-provider.interface'
import { GithubOidcService } from '@/authentication/githubOidc.service'
import { VercelOidcService } from '@/authentication/vercelOidc.service'
import { createMockLogger } from '@/shared/test-utils/mockLogger.util'
import { SessionsService } from '@/users/services/sessions.service'
import { UsersService } from '@/users/services/users.service'

const ISSUER = 'https://abc123-def456.tokens.sts.global.api.aws'
const ROLE = 'arn:aws:iam::123456789012:role/delegate-swarm-host'
const OTHER_ROLE = 'arn:aws:iam::123456789012:role/some-other-role'
const KID = 'test-aws-key'

@Controller('outreach/agent/handoffs')
class TestHandoffController {
  @Get('ping')
  @UseGuards(HandoffAgentGuard)
  ping() {
    return { ok: true }
  }
}

@Controller('outreach/agent/handoffs/open')
class UnguardedHandoffController {
  @Get('ping')
  ping() {
    return { ok: true }
  }
}

@Controller('outreach/agent/handoffs-evil')
class LookalikeController {
  @Get('ping')
  @UseGuards(HandoffAgentGuard)
  ping() {
    return { ok: true }
  }
}

@Controller('elsewhere')
class ElsewhereController {
  @Get('handoff-guard')
  @UseGuards(HandoffAgentGuard)
  handoffGuard() {
    return { ok: true }
  }

  @Get('m2m')
  @UseGuards(M2MOnly)
  m2m() {
    return { ok: true }
  }

  @Get('admin-or-m2m')
  @UseGuards(AdminOrM2MGuard)
  adminOrM2m() {
    return { ok: true }
  }

  @Get('service-read')
  @UseGuards(ServiceReadGuard)
  serviceRead() {
    return { ok: true }
  }

  @Get('public')
  @PublicAccess()
  open() {
    return { ok: true }
  }

  @Get('authed')
  authed() {
    return { ok: true }
  }
}

type SignOptions = {
  alg?: 'ES384' | 'RS256'
  audience?: string
  issuer?: string
  subject?: string
  expiresAt?: number
  keys?: GenerateKeyPairResult
}

let es384: GenerateKeyPairResult
let rs256: GenerateKeyPairResult
let rogue: GenerateKeyPairResult
let jwksBody: string
let app: NestFastifyApplication
let logger: PinoLogger

const realFetch = globalThis.fetch

const sign = async ({
  alg = 'ES384',
  audience = 'gp-api',
  issuer = ISSUER,
  subject = ROLE,
  expiresAt = Math.floor(Date.now() / 1000) + 300,
  keys,
}: SignOptions = {}): Promise<string> =>
  new SignJWT({
    'https://sts.amazonaws.com/': {
      aws_account: '123456789012',
      source_region: 'us-west-2',
    },
  })
    .setProtectedHeader({ alg, kid: `${KID}-${alg}`, typ: 'JWT' })
    .setIssuer(issuer)
    .setAudience(audience)
    .setSubject(subject)
    .setJti('jti-1')
    .setIssuedAt()
    .setExpirationTime(expiresAt)
    .sign((keys ?? (alg === 'ES384' ? es384 : rs256)).privateKey)

const get = async (path: string, token?: string) => {
  const res = await app.inject({
    method: 'GET',
    url: path,
    headers: token ? { authorization: `Bearer ${token}` } : {},
  })
  return res.statusCode
}

describe('AWS OIDC hand-off agent caller', () => {
  beforeAll(async () => {
    es384 = await generateKeyPair('ES384', { extractable: true })
    rs256 = await generateKeyPair('RS256', { extractable: true })
    rogue = await generateKeyPair('ES384', { extractable: true })
    jwksBody = JSON.stringify({
      keys: [
        {
          ...(await exportJWK(es384.publicKey)),
          kid: `${KID}-ES384`,
          alg: 'ES384',
          use: 'sig',
        },
        {
          ...(await exportJWK(rs256.publicKey)),
          kid: `${KID}-RS256`,
          use: 'sig',
        },
      ],
    })
    logger = createMockLogger()

    const moduleRef = await Test.createTestingModule({
      controllers: [
        TestHandoffController,
        UnguardedHandoffController,
        LookalikeController,
        ElsewhereController,
      ],
      providers: [
        { provide: APP_GUARD, useClass: SessionGuard },
        { provide: PinoLogger, useValue: logger },
        AwsOidcService,
        {
          provide: AUTH_PROVIDER_TOKEN,
          useValue: {
            isM2MToken: (token: string) => token.startsWith('mt_'),
            verifyM2MToken: async () => ({ id: 'm2m_1', subject: 'mch_1' }),
            verifySessionToken: async () => {
              throw new Error('not a session token')
            },
          },
        },
        { provide: UsersService, useValue: {} },
        { provide: SessionsService, useValue: { trackSession: vi.fn() } },
        { provide: AgentMcpMarker, useValue: { matches: () => false } },
        { provide: VercelOidcService, useValue: { verify: vi.fn() } },
        { provide: GithubOidcService, useValue: { verify: vi.fn() } },
      ],
    }).compile()
    app = moduleRef.createNestApplication<NestFastifyApplication>(
      new FastifyAdapter(),
    )
    await app.init()
    await app.getHttpAdapter().getInstance().ready()
  })

  afterAll(async () => {
    await app.close()
  })

  beforeEach(() => {
    vi.unstubAllEnvs()
    vi.stubEnv('AWS_OIDC_ISSUER', ISSUER)
    vi.stubEnv('AWS_OIDC_HANDOFF_AGENT_ROLES', ROLE)
    vi.mocked(logger.warn).mockClear()
    vi.mocked(logger.debug).mockClear()
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = input instanceof Request ? input.url : String(input)
      if (!url.startsWith(`${ISSUER}/`)) return realFetch(input, init)
      return new Response(jwksBody, {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    })
  })

  it.each(['ES384', 'RS256'] as const)(
    'passes HandoffAgentGuard on a hand-off route with a %s token',
    async (alg) => {
      expect(
        await get('/outreach/agent/handoffs/ping', await sign({ alg })),
      ).toBe(200)
    },
  )

  it('passes a full M2M token on a hand-off route', async () => {
    expect(await get('/outreach/agent/handoffs/ping', 'mt_ok')).toBe(200)
  })

  it.each([
    ['the wrong audience', { audience: 'https://api.example.com' }],
    ['the wrong issuer', { issuer: 'https://evil.tokens.sts.global.api.aws' }],
    ['a role not on the allowlist', { subject: OTHER_ROLE }],
    ['an expired token', { expiresAt: Math.floor(Date.now() / 1000) - 60 }],
    ['a key outside the JWKS', { keys: undefined, alg: 'ES384' as const }],
  ] as [string, SignOptions][])('401s %s', async (label, options) => {
    const token =
      label === 'a key outside the JWKS'
        ? await sign({ keys: rogue })
        : await sign(options)
    expect(await get('/outreach/agent/handoffs/ping', token)).toBe(401)
  })

  it('401s an unsigned token', async () => {
    const unsigned = [
      Buffer.from('{"alg":"none"}').toString('base64url'),
      Buffer.from(
        JSON.stringify({ iss: ISSUER, aud: 'gp-api', sub: ROLE }),
      ).toString('base64url'),
      '',
    ].join('.')
    expect(await get('/outreach/agent/handoffs/ping', unsigned)).toBe(401)
  })

  it('ignores every AWS token while the role allowlist is empty, with a debug log', async () => {
    vi.stubEnv('AWS_OIDC_HANDOFF_AGENT_ROLES', '')
    expect(await get('/outreach/agent/handoffs/ping', await sign())).toBe(401)
    expect(logger.debug).toHaveBeenCalledWith(
      expect.stringContaining('AWS OIDC token ignored'),
    )
  })

  it('ignores every AWS token while the issuer is unset', async () => {
    vi.stubEnv('AWS_OIDC_ISSUER', '')
    expect(await get('/outreach/agent/handoffs/ping', await sign())).toBe(401)
  })

  it.each([
    '/elsewhere/handoff-guard',
    '/elsewhere/m2m',
    '/elsewhere/admin-or-m2m',
    '/elsewhere/service-read',
    '/elsewhere/public',
    '/elsewhere/authed',
    '/outreach/agent/handoffs-evil/ping',
    '/outreach/agent/handoffs/open/ping',
  ])('401s the same valid token on %s', async (path) => {
    expect(await get(path, await sign())).toBe(401)
  })

  it('never logs the token', async () => {
    const token = await sign({ subject: OTHER_ROLE })
    await get('/outreach/agent/handoffs/ping', token)
    const logged = JSON.stringify([
      vi.mocked(logger.warn).mock.calls,
      vi.mocked(logger.debug).mock.calls,
    ])
    expect(logged).not.toContain(token)
  })

  it('still serves a public route without a token', async () => {
    expect(await get('/elsewhere/public')).toBe(200)
  })
})
