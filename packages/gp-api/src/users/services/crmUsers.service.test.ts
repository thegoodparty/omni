import { createMockLogger } from '@/shared/test-utils/mockLogger.util'
import { ApiException } from '@hubspot/api-client/lib/codegen/crm/contacts'
import { HttpService } from '@nestjs/axios'
import { BadGatewayException } from '@nestjs/common'
import axios from 'axios'
import { createServer, IncomingMessage, Server, ServerResponse } from 'http'
import { AddressInfo } from 'net'
import pino from 'pino'
import { of, throwError } from 'rxjs'
import { serializeError } from 'serialize-error'
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest'
import { Campaign, User } from '../../generated/prisma'
import { CrmUsersService } from './crmUsers.service'

describe('CrmUsersService - trackContact active-campaign selection', () => {
  const update = vi.fn()
  const hubspot = {
    client: { crm: { contacts: { basicApi: { update } } } },
  }
  const users = { patchUserMetaData: vi.fn() }
  const campaigns = { findActiveByUserId: vi.fn() }
  const logger = createMockLogger()

  let service: CrmUsersService

  const user = {
    id: 7,
    email: 'candidate@example.com',
    metaData: { hubspotId: 'hs-1' },
  } as unknown as User

  // A realistic findActiveByUserId return: it guarantees the isActiveCampaign
  // predicate (didWin null, future electionDate, not demo) but NOT the isActive
  // column, which only flips true at launch. So an active *run* can still be an
  // unlaunched campaign — active_candidate 'Yes' while live_candidate 'false'.
  const activeCampaign = {
    id: 222,
    isActive: false,
    isDemo: false,
    didWin: null,
    details: { electionDate: '2999-11-04' },
  } as unknown as Campaign

  beforeEach(() => {
    vi.clearAllMocks()
    update.mockResolvedValue({ id: 'hs-1' })
    users.patchUserMetaData.mockResolvedValue(undefined)
    service = new CrmUsersService(
      hubspot as never,
      users as never,
      campaigns as never,
      {} as never,
      {} as never,
      logger,
    )
  })

  it('resolves the active campaign and reflects it in CRM properties', async () => {
    campaigns.findActiveByUserId.mockResolvedValue(activeCampaign)

    await service.trackUserLogin(user)

    expect(campaigns.findActiveByUserId).toHaveBeenCalledWith(user.id)
    expect(update).toHaveBeenCalledWith(
      'hs-1',
      expect.objectContaining({
        properties: expect.objectContaining({
          active_candidate: 'Yes',
          live_candidate: 'false',
          product_user: 'yes',
        }),
      }),
    )
  })

  it('falls back gracefully when the user has no active campaign', async () => {
    campaigns.findActiveByUserId.mockResolvedValue(null)

    await service.trackUserLogin(user)

    expect(campaigns.findActiveByUserId).toHaveBeenCalledWith(user.id)
    expect(update).toHaveBeenCalledWith(
      'hs-1',
      expect.objectContaining({
        properties: expect.objectContaining({ active_candidate: 'No' }),
      }),
    )
  })
})

describe('CrmUsersService - submitCrmForm hutk forwarding', () => {
  const post = vi.fn()
  const hubspot = { client: { config: { accessToken: 'test-token' } } }
  const logger = createMockLogger()

  let service: CrmUsersService

  beforeEach(() => {
    vi.clearAllMocks()
    post.mockReturnValue(of({ data: {} }))
    service = new CrmUsersService(
      hubspot as never,
      {} as never,
      {} as never,
      { post } as never,
      {} as never,
      logger,
    )
  })

  it('includes context.hutk when the visitor cookie is provided', async () => {
    await service.submitCrmForm(
      'form-1',
      [{ name: 'email', value: 'a@b.co', objectTypeId: '0-1' }],
      'registerPage',
      'https://app.goodparty.org/sign-up',
      'visitor-hutk-value',
    )

    expect(post).toHaveBeenCalledWith(
      expect.stringContaining('form-1'),
      expect.objectContaining({
        context: {
          pageName: 'registerPage',
          pageUri: 'https://app.goodparty.org/sign-up',
          hutk: 'visitor-hutk-value',
        },
      }),
      expect.anything(),
    )
  })

  it('omits hutk from context when no cookie value is passed', async () => {
    await service.submitCrmForm(
      'form-1',
      [{ name: 'email', value: 'a@b.co', objectTypeId: '0-1' }],
      'registerPage',
      'https://app.goodparty.org/sign-up',
    )

    expect(post).toHaveBeenCalledWith(
      expect.stringContaining('form-1'),
      expect.objectContaining({
        context: {
          pageName: 'registerPage',
          pageUri: 'https://app.goodparty.org/sign-up',
        },
      }),
      expect.anything(),
    )
  })
})

describe('CrmUsersService - merge-tolerant contact lookups (ENG-11029)', () => {
  const doSearch = vi.fn()
  const create = vi.fn()
  const update = vi.fn()
  const hubspot = {
    client: {
      crm: {
        contacts: {
          searchApi: { doSearch },
          basicApi: { create, update },
        },
      },
    },
  }
  const users = { patchUserMetaData: vi.fn() }
  const campaigns = { findActiveByUserId: vi.fn() }
  const logger = createMockLogger()

  let service: CrmUsersService

  // No cached hubspotId, so trackContact always falls through to a fresh
  // email lookup — the path the merge-survivor shape has to travel.
  const user = {
    id: 42,
    email: 'survivor-search@example.com',
    metaData: {},
  } as unknown as User

  beforeEach(() => {
    vi.clearAllMocks()
    campaigns.findActiveByUserId.mockResolvedValue(null)
    users.patchUserMetaData.mockResolvedValue(undefined)
    service = new CrmUsersService(
      hubspot as never,
      users as never,
      campaigns as never,
      {} as never,
      {} as never,
      logger,
    )
  })

  it('adopts a search result whose primary email differs (merged survivor) and updates it', async () => {
    doSearch.mockResolvedValue({
      total: 1,
      results: [
        { id: 'hs-survivor', properties: { email: 'primary@example.com' } },
      ],
    })
    update.mockResolvedValue({ id: 'hs-survivor' })

    await service.trackUserLogin(user)

    expect(create).not.toHaveBeenCalled()
    expect(update).toHaveBeenCalledWith(
      'hs-survivor',
      expect.objectContaining({
        properties: expect.objectContaining({
          email: 'survivor-search@example.com',
        }),
      }),
    )
    expect(users.patchUserMetaData).toHaveBeenCalledWith(user.id, {
      hubspotId: 'hs-survivor',
    })
  })

  it('adopts the existing id when create 409s, persists it, and updates that contact', async () => {
    doSearch.mockResolvedValue({ total: 0, results: [] })
    create.mockRejectedValue(
      new ApiException(
        409,
        'Conflict',
        { message: 'Contact already exists. Existing ID: 909090' },
        {},
      ),
    )
    update.mockResolvedValue({ id: '909090' })

    const result = await service.trackUserLogin(user)

    expect(update).toHaveBeenCalledWith(
      '909090',
      expect.objectContaining({
        properties: expect.objectContaining({
          email: 'survivor-search@example.com',
          lifecyclestage: 'opportunity',
        }),
      }),
    )
    expect(users.patchUserMetaData).toHaveBeenCalledWith(user.id, {
      hubspotId: '909090',
    })
    expect(result).toEqual({ id: '909090' })
  })

  it('persists the adopted id even when the follow-up update fails', async () => {
    doSearch.mockResolvedValue({ total: 0, results: [] })
    create.mockRejectedValue(
      new ApiException(
        409,
        'Conflict',
        { message: 'Contact already exists. Existing ID: 909090' },
        {},
      ),
    )
    update.mockRejectedValue(new Error('hubspot transient failure'))

    const result = await service.trackUserLogin(user)

    expect(users.patchUserMetaData).toHaveBeenCalledWith(user.id, {
      hubspotId: '909090',
    })
    expect(result).toEqual({ id: '909090' })
  })

  it('leaves a non-409 create failure unchanged: logged, no adoption, undefined', async () => {
    doSearch.mockResolvedValue({ total: 0, results: [] })
    create.mockRejectedValue(new Error('hubspot down'))

    const result = await service.trackUserLogin(user)

    expect(update).not.toHaveBeenCalled()
    expect(users.patchUserMetaData).not.toHaveBeenCalledWith(
      user.id,
      expect.objectContaining({ hubspotId: expect.anything() }),
    )
    expect(logger.error).toHaveBeenCalled()
    expect(result).toBeUndefined()
  })

  it('regression: an exact-match search still resolves and updates the same id', async () => {
    doSearch.mockResolvedValue({
      total: 1,
      results: [
        {
          id: 'hs-exact',
          properties: { email: 'survivor-search@example.com' },
        },
      ],
    })
    update.mockResolvedValue({ id: 'hs-exact' })

    await service.trackUserLogin(user)

    expect(create).not.toHaveBeenCalled()
    expect(update).toHaveBeenCalledWith(
      'hs-exact',
      expect.objectContaining({
        properties: expect.objectContaining({
          email: 'survivor-search@example.com',
        }),
      }),
    )
  })

  it('regression: an empty search result still routes to create', async () => {
    doSearch.mockResolvedValue({ total: 0, results: [] })
    create.mockResolvedValue({ id: 'hs-new' })

    await service.trackUserLogin(user)

    expect(update).not.toHaveBeenCalled()
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        properties: expect.objectContaining({
          email: 'survivor-search@example.com',
        }),
      }),
    )
    expect(users.patchUserMetaData).toHaveBeenCalledWith(user.id, {
      hubspotId: 'hs-new',
    })
  })
})

describe('CrmUsersService test-user guard', () => {
  const update = vi.fn()
  const create = vi.fn()
  const post = vi.fn()
  const hubspot = {
    client: {
      config: { accessToken: 'token' },
      crm: { contacts: { basicApi: { update, create } } },
    },
  }
  const users = { patchUserMetaData: vi.fn() }
  const campaigns = { findActiveByUserId: vi.fn() }
  const logger = createMockLogger()

  const buildService = () =>
    new CrmUsersService(
      hubspot as never,
      users as never,
      campaigns as never,
      { post } as never,
      {} as never,
      logger,
    )

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('skips contact sync for an e2e test user', async () => {
    await buildService().trackUserLogin({
      id: 7,
      email: 'test-1790009-abcde@test.goodparty.org',
      metaData: { hubspotId: 'hs-1' },
    } as unknown as User)

    expect(update).not.toHaveBeenCalled()
    expect(create).not.toHaveBeenCalled()
    expect(users.patchUserMetaData).not.toHaveBeenCalled()
  })

  it('skips contact sync for a QA fixture user', async () => {
    await buildService().trackUserLogin({
      id: 8,
      email: 'qa-123e4567-e89b-12d3-a456-426614174000@goodparty.org',
      metaData: {},
    } as unknown as User)

    expect(update).not.toHaveBeenCalled()
    expect(create).not.toHaveBeenCalled()
  })

  it('skips form submission when the email field is a test user', async () => {
    await buildService().submitCrmForm(
      'form-1',
      [{ name: 'email', value: 'test-1790009-abcde@test.goodparty.org' }],
      'registerPage',
      'https://goodparty.org/sign-up',
    )

    expect(post).not.toHaveBeenCalled()
  })

  describe('retry', () => {
    it('retries once when HubSpot gives no response', async () => {
      const failing = vi.fn()
      const err = Object.assign(new Error('socket hang up'), {
        isAxiosError: true,
        code: 'ECONNRESET',
        request: {},
      })
      failing
        .mockReturnValueOnce(throwError(() => err))
        .mockReturnValueOnce(of({ data: {} }))
      const svc = new CrmUsersService(
        { client: { config: { accessToken: 't' } } } as never,
        {} as never,
        {} as never,
        { post: failing } as never,
        {} as never,
        createMockLogger(),
      )

      await svc.submitCrmForm(
        'form-1',
        [{ name: 'email', value: 'a@b.co', objectTypeId: '0-1' }],
        'registerPage',
        'https://app.goodparty.org/sign-up',
      )

      expect(failing).toHaveBeenCalledTimes(2)
    })

    it('does not retry a 4xx and reports its status', async () => {
      const failing = vi.fn()
      const err = Object.assign(new Error('bad'), {
        isAxiosError: true,
        response: { status: 400, data: { message: 'bad field' } },
      })
      failing.mockReturnValue(throwError(() => err))
      const svc = new CrmUsersService(
        { client: { config: { accessToken: 't' } } } as never,
        {} as never,
        {} as never,
        { post: failing } as never,
        { errorMessage: vi.fn() } as never,
        createMockLogger(),
      )

      await expect(
        svc.submitCrmForm(
          'form-1',
          [{ name: 'email', value: 'a@b.co', objectTypeId: '0-1' }],
          'registerPage',
          'https://app.goodparty.org/sign-up',
        ),
      ).rejects.toThrow('Error submitting form to HubSpot: 400')
      expect(failing).toHaveBeenCalledTimes(1)
    })
  })
})

describe('CrmUsersService - submitCrmForm failure logging (ENG-11358)', () => {
  const EMAIL = 'jane.voter@example.com'
  const FIRST_NAME = 'Janetta'
  const fields = [
    { name: 'email', value: EMAIL },
    { name: 'firstname', value: FIRST_NAME },
  ]
  const hubspot = { client: { config: { accessToken: 'test-token' } } }
  const slack = { errorMessage: vi.fn() }
  const logger = createMockLogger()

  let server: Server
  let baseUrl: string
  let respond: (req: IncomingMessage, res: ServerResponse) => void

  beforeAll(async () => {
    server = createServer((req, res) => respond(req, res))
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  })

  afterAll(async () => {
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve())),
    )
  })

  beforeEach(() => {
    vi.clearAllMocks()
  })

  // A real axios failure, so the logged error carries everything a
  // production AxiosError does: config, request and response.
  const submit = () => {
    const instance = axios.create()
    instance.interceptors.request.use((config) => {
      config.url = `${baseUrl}/submit`
      return config
    })
    return new CrmUsersService(
      hubspot as never,
      {} as never,
      {} as never,
      new HttpService(instance),
      slack as never,
      logger,
    ).submitCrmForm(
      'form-1',
      fields,
      'registerPage',
      'https://goodparty.org/sign-up',
    )
  }

  // What pino writes to stdout, configured like logger-module.ts.
  const loggedOutput = (level: 'warn' | 'error' = 'error') => {
    const lines: string[] = []
    const output = pino(
      {
        base: null,
        formatters: {
          log: (obj) => {
            for (const key of Object.keys(obj)) {
              if (obj[key] instanceof Error) {
                obj[key] = pino.stdSerializers.err(obj[key])
              }
            }
            return obj
          },
        },
      },
      { write: (line: string) => lines.push(line) },
    )
    const [logFields, message] = vi.mocked(logger[level]).mock.calls[0] as [
      object,
      string,
    ]
    output[level](logFields, message)
    return lines.join('')
  }

  const slackOutput = () => {
    const [{ error }] = slack.errorMessage.mock.calls[0] as [{ error: Error }]
    return JSON.stringify(serializeError(error))
  }

  it('logs HubSpot status and error types when HubSpot rejects the form', async () => {
    respond = (req, res) => {
      req.resume()
      req.on('end', () => {
        res.writeHead(400, { 'content-type': 'application/json' })
        res.end(
          JSON.stringify({
            status: 'error',
            message: 'The request is not valid',
            correlationId: 'corr-1',
            errors: [
              {
                message: "Error in 'fields.email'. Invalid email address",
                errorType: 'INVALID_EMAIL',
              },
            ],
          }),
        )
      })
    }

    await expect(submit()).rejects.toThrow(
      new BadGatewayException('Error submitting form to HubSpot: 400'),
    )

    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({
        err: expect.objectContaining({ code: 'ERR_BAD_REQUEST' }),
        formId: 'form-1',
        hubspotStatus: 400,
        hubspotCorrelationId: 'corr-1',
        hubspotErrorTypes: ['INVALID_EMAIL'],
      }),
      expect.any(String),
    )
    expect(loggedOutput()).not.toContain(EMAIL)
    expect(loggedOutput()).not.toContain(FIRST_NAME)
    expect(slackOutput()).not.toContain(EMAIL)
  })

  it('names the network error when HubSpot never responds', async () => {
    respond = (req) => req.socket.destroy()

    await expect(submit()).rejects.toThrow(
      new BadGatewayException('Error submitting form to HubSpot: ECONNRESET'),
    )

    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        err: expect.objectContaining({ code: 'ECONNRESET' }),
        formId: 'form-1',
      }),
      expect.any(String),
    )
    expect(loggedOutput('warn')).not.toContain(EMAIL)
    expect(loggedOutput('warn')).not.toContain(FIRST_NAME)
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({
        err: expect.objectContaining({ code: 'ECONNRESET' }),
        formId: 'form-1',
        hubspotStatus: undefined,
      }),
      expect.any(String),
    )
    expect(loggedOutput()).not.toContain(EMAIL)
    expect(loggedOutput()).not.toContain(FIRST_NAME)
    expect(slackOutput()).not.toContain(EMAIL)
  })
})
