import { Client } from 'pg'
import { randomBytes } from 'crypto'
import { appendFileSync, writeFileSync } from 'fs'
import { Session } from 'inspector'
import { NestFastifyApplication } from '@nestjs/platform-fastify'
import { DependenciesScanner } from '@nestjs/core/scanner'
import { InstanceLoader } from '@nestjs/core/injector/instance-loader'
import { NestApplication } from '@nestjs/core'
import { NestContainer } from '@nestjs/core/injector/container'
import { Injector } from '@nestjs/core/injector/injector'
import { expect, test } from 'vitest'
import axios from 'axios'
import { bootstrap } from './app'
import { templateDbName, testPostgresUri, withDatabase } from './test-postgres'

const OUT = process.env.BOOT_PROFILE_OUT ?? '/tmp/boot-profile-detail.jsonl'
const RUNS = Number(process.env.BOOT_PROFILE_RUNS ?? 6)

type Timings = Record<string, number>
let current: Timings = {}
const hookTimes: Record<string, number> = {}

const wrap = <T extends object>(proto: T, method: string, label: string) => {
  const target = proto as Record<string, (...args: unknown[]) => unknown>
  const original = target[method]
  target[method] = async function (this: unknown, ...args: unknown[]) {
    const t = performance.now()
    try {
      return await original.apply(this, args)
    } finally {
      current[label] = (current[label] ?? 0) + performance.now() - t
    }
  }
}

wrap(DependenciesScanner.prototype, 'scan', 'nest.scan')
wrap(
  InstanceLoader.prototype,
  'createInstancesOfDependencies',
  'nest.instantiate',
)
wrap(NestApplication.prototype, 'registerRouter', 'init.registerRouter')
wrap(NestApplication.prototype, 'registerModules', 'init.registerModules')
wrap(NestApplication.prototype, 'callInitHook', 'init.onModuleInit')
wrap(NestApplication.prototype, 'callBootstrapHook', 'init.onAppBootstrap')
wrap(NestApplication.prototype, 'callDestroyHook', 'close.onModuleDestroy')
wrap(NestApplication.prototype, 'callShutdownHook', 'close.onAppShutdown')
wrap(
  NestApplication.prototype,
  'callBeforeShutdownHook',
  'close.beforeShutdown',
)
wrap(NestApplication.prototype, 'dispose', 'close.dispose')

const ctorTimes: Record<string, number> = {}
const ctorWall: Record<string, number> = {}
{
  const target = Injector.prototype as unknown as Record<
    string,
    (...args: unknown[]) => Promise<unknown>
  >
  const original = target.instantiateClass
  target.instantiateClass = function (this: unknown, ...args: unknown[]) {
    const wrapper = args[1] as { name: string | symbol }
    const name = String(wrapper.name)
    const t = performance.now()
    const p = original.apply(this, args)
    ctorTimes[name] = (ctorTimes[name] ?? 0) + performance.now() - t
    return p.finally(() => {
      ctorWall[name] = (ctorWall[name] ?? 0) + performance.now() - t
    })
  }
}

const HOOKS = [
  'onModuleInit',
  'onApplicationBootstrap',
  'onModuleDestroy',
  'beforeApplicationShutdown',
  'onApplicationShutdown',
]

const wrapProviderHooks = (app: NestFastifyApplication) => {
  const container = (app as unknown as { container: NestContainer }).container
  for (const mod of container.getModules().values()) {
    for (const collection of [mod.providers, mod.controllers, mod.injectables]) {
      for (const wrapper of collection.values()) {
        const instance = wrapper.instance as Record<string, unknown> | null
        if (!instance || typeof instance !== 'object') continue
        for (const hook of HOOKS) {
          const fn = instance[hook]
          if (typeof fn !== 'function') continue
          const name = `${hook}:${String(wrapper.name)}`
          instance[hook] = async (...args: unknown[]) => {
            const t = performance.now()
            try {
              return await (fn as (...a: unknown[]) => unknown).apply(
                instance,
                args,
              )
            } finally {
              hookTimes[name] = (hookTimes[name] ?? 0) + performance.now() - t
            }
          }
        }
      }
    }
  }
  let count = 0
  for (const mod of container.getModules().values()) {
    count += mod.providers.size + mod.controllers.size
  }
  return { modules: container.getModules().size, count }
}

const time = async <T>(label: string, fn: () => Promise<T>): Promise<T> => {
  const t = performance.now()
  try {
    return await fn()
  } finally {
    current[label] = (current[label] ?? 0) + performance.now() - t
  }
}

test(
  'boot profile',
  async () => {
    const session = new Session()
    session.connect()
    const post = (method: string, params?: object) =>
      new Promise<unknown>((resolve, reject) =>
        session.post(method, params, (err, res) =>
          err ? reject(err) : resolve(res),
        ),
      )
    await post('Profiler.enable')
    await post('Profiler.setSamplingInterval', { interval: 200 })
    for (let i = 0; i < RUNS; i++) {
      if (i === 1 && process.env.BOOT_CPU_PROFILE) await post('Profiler.start')
      current = {}
      for (const k of Object.keys(hookTimes)) delete hookTimes[k]
      for (const k of Object.keys(ctorTimes)) delete ctorTimes[k]
      for (const k of Object.keys(ctorWall)) delete ctorWall[k]
      const t0 = performance.now()
      const base = await time('testPostgresUri', () => testPostgresUri())
      const db = `test_db_${randomBytes(8).toString('hex')}`
      const admin = new Client({ connectionString: base })
      await time('admin.connect', () => admin.connect())
      await time('cloneDb', () =>
        admin.query(`CREATE DATABASE ${db} TEMPLATE ${templateDbName()}`),
      )
      process.env.DATABASE_URL = `${withDatabase(base, db)}?connection_limit=5`
      process.env.TEST_SCHEDULER = 'off'
      const app = await time('bootstrap', () =>
        bootstrap({ loggingEnabled: false }),
      )
      const counts = wrapProviderHooks(app)
      await time('app.init', () => app.init())
      await time('listen', () => app.listen({ port: 0, host: '127.0.0.1' }))
      const address = app.getHttpServer().address()
      const port = typeof address === 'object' && address ? address.port : 0
      const client = axios.create({
        baseURL: `http://127.0.0.1:${port}`,
        validateStatus: () => true,
      })
      for (let r = 0; r < 20; r++) {
        await time('axios x20', () => client.get('/v1/health'))
        await time('inject x20', () =>
          app.getHttpAdapter().getInstance().inject({ url: '/v1/health' }),
        )
      }
      const res = await app
        .getHttpAdapter()
        .getInstance()
        .inject({ url: '/v1/health' })
      expect(res.statusCode).toBeLessThan(500)
      const bootDone = performance.now()
      if (i === RUNS - 1 && process.env.BOOT_CPU_PROFILE) {
        const { profile } = (await post('Profiler.stop')) as { profile: object }
        writeFileSync(process.env.BOOT_CPU_PROFILE, JSON.stringify(profile))
      }
      await time('app.close', () => app.close())
      await time('dropDb', () =>
        admin.query(`DROP DATABASE IF EXISTS ${db} WITH (FORCE)`),
      )
      await admin.end()
      current['total(excl requests)'] =
        performance.now() - t0 - current['axios x20'] - current['inject x20']
      current['bootOnly'] = bootDone - t0 - current['axios x20'] - current['inject x20']
      appendFileSync(
        OUT,
        JSON.stringify({ run: i, counts, timings: current, hookTimes, ctorTimes, ctorWall }) + '\n',
      )
    }
  },
  600_000,
)
