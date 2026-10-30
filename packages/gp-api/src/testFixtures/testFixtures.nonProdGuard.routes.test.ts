import { HttpStatus } from '@nestjs/common'
import { readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { useTestService } from '@/test-service'
import {
  NON_PROD_DEPLOY_ONLY_KEY,
  NonProdDeployGuard,
} from './guards/NonProdDeploy.guard'

const { envNonProd } = vi.hoisted(() => ({ envNonProd: { value: false } }))
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

const service = useTestService()

const keepStatus = { validateStatus: () => true }
const anonymous = { ...keepStatus, headers: { Authorization: 'Bearer bad' } }

// One route per controller in src/testFixtures/.
const ROUTES: { controller: string; method: 'get' | 'post'; url: string }[] = [
  { controller: 'TestFixturesController', method: 'post', url: '/users' },
  {
    controller: 'TestFixturesJudgeController',
    method: 'post',
    url: '/judge-chat-cases',
  },
  {
    controller: 'TestFixturesPollResultsController',
    method: 'post',
    url: '/polls/results',
  },
  {
    controller: 'TestFixturesScenariosController',
    method: 'get',
    url: '/races/resolve',
  },
  {
    controller: 'TestFixturesStatesController',
    method: 'post',
    url: '/users/1/states/pro-win-10dlc-mock',
  },
  {
    controller: 'TestFixturesVendorMocksController',
    method: 'get',
    url: '/vendor-mocks/records',
  },
  {
    controller: 'TestFixturesVendorMocksController',
    method: 'post',
    url: '/vendor-mocks/people-db/email-audience',
  },
]

const call = (
  { method, url }: (typeof ROUTES)[number],
  config: object = keepStatus,
) =>
  method === 'get'
    ? service.client.get(`/v1/test-fixtures${url}`, config)
    : service.client.post(`/v1/test-fixtures${url}`, {}, config)

describe('NonProdDeployGuard on every test-fixture controller', () => {
  describe.each(ROUTES)('$controller $url', (route) => {
    it('answers 404 on a prod deploy, before any auth work', async () => {
      envNonProd.value = false
      expect((await call(route)).status).toBe(HttpStatus.NOT_FOUND)
      expect((await call(route, anonymous)).status).toBe(HttpStatus.NOT_FOUND)
    })

    it('leaves the route to its own auth on a non-prod deploy', async () => {
      envNonProd.value = true
      expect((await call(route, anonymous)).status).toBe(
        HttpStatus.UNAUTHORIZED,
      )
    })
  })

  it('covers every controller class in the folder', async () => {
    const files = readdirSync(__dirname, { recursive: true })
      .map(String)
      .filter((f) => f.endsWith('.controller.ts'))
    expect(files.length).toBe(new Set(ROUTES.map((r) => r.controller)).size)

    const controllers = (
      await Promise.all(files.map((f) => import(join(__dirname, f))))
    ).flatMap((mod) =>
      Object.entries<object>(mod).filter(([name]) =>
        name.endsWith('Controller'),
      ),
    )
    expect(controllers.map(([name]) => name).sort()).toEqual(
      [...new Set(ROUTES.map((r) => r.controller))].sort(),
    )

    for (const [name, controller] of controllers) {
      expect(
        Reflect.getMetadata(NON_PROD_DEPLOY_ONLY_KEY, controller),
        name,
      ).toBe(true)
      expect(Reflect.getMetadata('__guards__', controller), name).toContain(
        NonProdDeployGuard,
      )
    }
  })
})
