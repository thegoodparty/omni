import { Client } from 'pg'
import { randomBytes } from 'crypto'
import { appendFileSync, writeFileSync } from 'fs'
import { Session } from 'inspector'
import { loadavg } from 'os'
import { PerformanceObserver } from 'perf_hooks'
import { getHeapSpaceStatistics } from 'v8'
import { NestApplication } from '@nestjs/core'
import { STATIC_CONTEXT } from '@nestjs/core/injector/constants'
import { Injector } from '@nestjs/core/injector/injector'
import { InstanceWrapper } from '@nestjs/core/injector/instance-wrapper'
import { expect, test } from 'vitest'
import { bootstrap } from './app'
import { templateDbName, testPostgresUri, withDatabase } from './test-postgres'

const OUT = process.env.BENCH_OUT ?? '/tmp/nest-boot-bench.jsonl'
const RUNS = Number(process.env.BENCH_RUNS ?? 0)
const WARMUP = Number(process.env.BENCH_WARMUP ?? 2)
const LABEL = process.env.BENCH_LABEL ?? 'default'
const CPU_PROFILE = process.env.BENCH_CPU_PROFILE
const VARIANTS = (process.env.BENCH_VARIANTS ?? 'base').split(',')

type Proto = Record<string, (...args: unknown[]) => unknown>
const iwProto = InstanceWrapper.prototype as unknown as Proto
const injProto = Injector.prototype as unknown as Proto
const appProto = NestApplication.prototype as unknown as Proto
const originals = {
  resetDependencyTreeState: iwProto.resetDependencyTreeState,
  addCtorMetadata: iwProto.addCtorMetadata,
  iwIsDebugMode: iwProto.isDebugMode,
  injIsDebugMode: injProto.isDebugMode,
  lookupComponentInImports: injProto.lookupComponentInImports,
  registerRouter: appProto.registerRouter,
}

type W = {
  isTreeStatic?: boolean
  isTreeDurable?: boolean
  resetDependencyTreeState: (r?: Set<string>) => void
  [k: symbol]: unknown
}

const counts: Record<string, number> = {}
const bump = (k: string) => (counts[k] = (counts[k] ?? 0) + 1)

const resetEarlyExit = function (this: W, lookupRegistry?: Set<string>) {
  if (this.isTreeStatic === undefined && this.isTreeDurable === undefined) {
    return
  }
  return (
    originals.resetDependencyTreeState as (
      this: W,
      r?: Set<string>,
    ) => void
  ).call(this, lookupRegistry)
}

const META = Symbol.for('instance_metadata:cache')
const addCtorDedupe = function (
  this: W & { [META]: { dependencies?: unknown[] } },
  index: number,
  wrapper: unknown,
) {
  if (this[META].dependencies?.[index] === wrapper) return
  return originals.addCtorMetadata.call(this, index, wrapper)
}

const debugOff = () => false

type ModuleRef = {
  id: string
  imports?: Set<ModuleRef | undefined>
  exports: Set<unknown>
  providers: Map<unknown, InstanceWrapper>
  metatype: unknown
}
type InjectorThis = {
  addDependencyMetadata: (k: unknown, w: unknown, i: unknown) => void
  getContextInquirerId: (c: unknown) => string | undefined
  getContextId: (c: unknown, w: unknown) => unknown
}
const lookupSync = function (
  this: InjectorThis,
  moduleRef: ModuleRef,
  name: unknown,
  wrapper: unknown,
  moduleRegistry: Set<string>,
  resolutionContext: { contextId: unknown },
  keyOrIndex: unknown,
  isTraversing?: boolean,
): InstanceWrapper | null {
  let instanceWrapperRef: InstanceWrapper | null = null
  const imports = moduleRef.imports
  if (!imports) return null
  for (const relatedModule of imports) {
    if (!relatedModule) continue
    if (isTraversing && !moduleRef.exports.has(relatedModule.metatype)) continue
    if (moduleRegistry.has(relatedModule.id)) continue
    moduleRegistry.add(relatedModule.id)
    const { providers, exports } = relatedModule
    if (!exports.has(name) || !providers.has(name)) {
      const instanceRef = lookupSync.call(
        this,
        relatedModule,
        name,
        wrapper,
        moduleRegistry,
        resolutionContext,
        keyOrIndex,
        true,
      )
      if (instanceRef) {
        this.addDependencyMetadata(keyOrIndex, wrapper, instanceRef)
        return instanceRef
      }
      continue
    }
    instanceWrapperRef = providers.get(name)!
    this.addDependencyMetadata(keyOrIndex, wrapper, instanceWrapperRef)
    const inquirerId = this.getContextInquirerId(resolutionContext)
    const ref = instanceWrapperRef as unknown as {
      forwardRef?: boolean
      getInstanceByContextId: (
        c: unknown,
        i: string | undefined,
      ) => { isResolved?: boolean }
    }
    const instanceHost = ref.getInstanceByContextId(
      this.getContextId(resolutionContext.contextId, instanceWrapperRef),
      inquirerId,
    )
    if (!instanceHost.isResolved && !ref.forwardRef) break
  }
  return instanceWrapperRef
}
const lookupInImportsSync = function (
  this: InjectorThis,
  moduleRef: ModuleRef,
  name: unknown,
  wrapper: unknown,
  moduleRegistry: Set<string> = new Set(),
  resolutionContext: { contextId: unknown } = { contextId: STATIC_CONTEXT },
  keyOrIndex?: unknown,
  isTraversing?: boolean,
) {
  return Promise.resolve(
    lookupSync.call(
      this,
      moduleRef,
      name,
      wrapper,
      moduleRegistry,
      resolutionContext,
      keyOrIndex,
      isTraversing,
    ),
  )
}

const countingWrap = (proto: Proto, method: string, key: string) => {
  const original = proto[method]
  proto[method] = function (this: unknown, ...args: unknown[]) {
    bump(key)
    return original.apply(this, args)
  }
}

const apply = (variant: string) => {
  iwProto.resetDependencyTreeState = originals.resetDependencyTreeState
  iwProto.addCtorMetadata = originals.addCtorMetadata
  iwProto.isDebugMode = originals.iwIsDebugMode
  injProto.isDebugMode = originals.injIsDebugMode
  injProto.lookupComponentInImports = originals.lookupComponentInImports
  const parts = variant.split('+')
  delete process.env.SPIKE_LAZY_PASSTHROUGH
  globalThis.__spikeNestOptions = undefined
  globalThis.__spikeSkipUseLogger = undefined
  if (parts.includes('lazy')) process.env.SPIKE_LAZY_PASSTHROUGH = '1'
  if (parts.includes('nobuffer')) {
    globalThis.__spikeNestOptions = { bufferLogs: false }
  }
  if (parts.includes('abort')) {
    globalThis.__spikeNestOptions = { abortOnError: true }
  }
  if (parts.includes('nouselogger')) globalThis.__spikeSkipUseLogger = true
  if (parts.includes('reset') || parts.includes('all')) {
    iwProto.resetDependencyTreeState = resetEarlyExit as Proto[string]
  }
  if (parts.includes('dedupe') || parts.includes('all')) {
    iwProto.addCtorMetadata = addCtorDedupe as Proto[string]
  }
  if (parts.includes('debug') || parts.includes('all')) {
    iwProto.isDebugMode = debugOff
    injProto.isDebugMode = debugOff
  }
  if (parts.includes('lookup') || parts.includes('all')) {
    injProto.lookupComponentInImports = lookupInImportsSync as Proto[string]
  }
  if (parts.includes('count')) {
    countingWrap(iwProto, 'resetDependencyTreeState', 'resetDependencyTreeState')
    countingWrap(iwProto, 'addCtorMetadata', 'addCtorMetadata')
    countingWrap(iwProto, 'isDebugMode', 'iw.isDebugMode')
    countingWrap(injProto, 'isDebugMode', 'injector.isDebugMode')
    countingWrap(
      injProto,
      'lookupComponentInImports',
      'lookupComponentInImports',
    )
  }
}

const treeFlags = (app: NestApplication) => {
  const container = (
    app as unknown as {
      container: {
        getModules: () => Map<
          string,
          {
            name: string
            providers: Map<unknown, W>
            controllers: Map<unknown, W>
            injectables: Map<unknown, W>
          }
        >
      }
    }
  ).container
  const flags: string[] = []
  for (const mod of container.getModules().values()) {
    for (const col of [mod.providers, mod.controllers, mod.injectables]) {
      for (const [token, w] of col) {
        const iw = w as unknown as InstanceWrapper
        flags.push(
          `${mod.name}:${String((token as { name?: string }).name ?? token)}:${iw.isDependencyTreeStatic()}:${iw.isDependencyTreeDurable()}`,
        )
      }
    }
  }
  return flags.sort()
}

test.skipIf(!RUNS)(
  'nest boot bench',
  async () => {
    const base = await testPostgresUri()
    const db = `test_db_${randomBytes(8).toString('hex')}`
    const admin = new Client({ connectionString: base })
    await admin.connect()
    await admin.query(`CREATE DATABASE ${db} TEMPLATE ${templateDbName()}`)
    process.env.DATABASE_URL = `${withDatabase(base, db)}?connection_limit=5`
    process.env.TEST_SCHEDULER = 'off'

    let gcMs = 0
    let gcCount = 0
    const obs = new PerformanceObserver((list) => {
      for (const e of list.getEntries()) {
        gcMs += e.duration
        gcCount++
      }
    })
    obs.observe({ entryTypes: ['gc'] })

    const session = new Session()
    const post = (method: string, params?: object) =>
      new Promise<unknown>((resolve, reject) =>
        session.post(method, params, (err, res) =>
          err ? reject(err) : resolve(res),
        ),
      )
    if (CPU_PROFILE) {
      session.connect()
      await post('Profiler.enable')
      await post('Profiler.setSamplingInterval', { interval: 200 })
    }
    try {
      for (let i = 0; i < WARMUP + RUNS * VARIANTS.length; i++) {
        const variant = VARIANTS[i % VARIANTS.length]
        apply(variant)
        if (CPU_PROFILE && i === WARMUP) await post('Profiler.start')
        for (const k of Object.keys(counts)) delete counts[k]
        globalThis.__bootMarks = []
        await new Promise((r) => setTimeout(r, 50))
        gcMs = 0
        gcCount = 0
        const load = loadavg()[0]
        const t0 = performance.now()
        const app = await bootstrap({ loggingEnabled: false })
        const marks = Object.fromEntries(globalThis.__bootMarks ?? [])
        const tBoot = performance.now()
        await app.init()
        const tInit = performance.now()
        await app.listen({ port: 0, host: '127.0.0.1' })
        const tListen = performance.now()
        const flags =
          process.env.BENCH_FLAGS && i >= WARMUP
            ? treeFlags(app as unknown as NestApplication)
            : undefined
        const res = await app
          .getHttpAdapter()
          .getInstance()
          .inject({ url: '/v1/health' })
        expect(res.statusCode).toBeLessThan(500)
        const tReq = performance.now()
        await app.close()
        const tClose = performance.now()
        await new Promise((r) => setTimeout(r, 0))
        globalThis.__bootMarks = undefined
        if (i < WARMUP) continue
        const create =
          (marks.nestFactoryCreate as number) - (marks.adapterReady as number)
        appendFileSync(
          OUT,
          JSON.stringify({
            label: LABEL,
            variant,
            node: process.version,
            nodeOptions: process.env.NODE_OPTIONS,
            newSpace: getHeapSpaceStatistics().find(
              (sp) => sp.space_name === 'new_space',
            )?.space_size,
            i,
            load,
            create,
            preCreate: (marks.adapterReady as number) - t0,
            bootstrapTail: tBoot - (marks.nestFactoryCreate as number),
            init: tInit - tBoot,
            listen: tListen - tInit,
            close: tClose - tReq,
            total: tListen - t0 + (tClose - tReq),
            gcMs,
            gcCount,
            counts: Object.keys(counts).length ? { ...counts } : undefined,
            flagsHash: flags
              ? (await import('crypto'))
                  .createHash('sha1')
                  .update(flags.join('\n'))
                  .digest('hex')
              : undefined,
            flagsCount: flags?.length,
            flagsNonStatic: flags?.filter((f) => !f.endsWith(':true:false')),
          }) + '\n',
        )
      }
      if (CPU_PROFILE) {
        const { profile } = (await post('Profiler.stop')) as { profile: object }
        writeFileSync(CPU_PROFILE, JSON.stringify(profile))
      }
    } finally {
      obs.disconnect()
      apply('base')
      await admin.query(`DROP DATABASE IF EXISTS ${db} WITH (FORCE)`)
      await admin.end()
    }
  },
  1_800_000,
)
