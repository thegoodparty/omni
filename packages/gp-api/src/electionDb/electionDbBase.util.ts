import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common'
import { lowerFirst } from 'lodash'
import { Prisma } from '../generated/election-prisma'
import { ElectionDbPrismaClient, ElectionDbService } from './electionDb.service'

export const ELECTION_MODELS = Prisma.ModelName

type ExcludeTypes = `$${string}` | symbol
type ElectionDbModels = Exclude<keyof ElectionDbPrismaClient, ExcludeTypes>
type ElectionDbMethods = Exclude<
  keyof ElectionDbPrismaClient[ElectionDbModels],
  ExcludeTypes
>

// These are methods that should be available as public methods on any
// election-db model service, e.g. this.placesService.findMany(...args) --
// this allows us to avoid manually redeclaring types when we just want to
// make a prisma method available directly
const PASSTHROUGH_MODEL_METHODS = [
  'findMany',
  'findFirst',
  'findFirstOrThrow',
  'findUnique',
  'findUniqueOrThrow',
  'count',
] satisfies ElectionDbMethods[]

export function createElectionDbBase<T extends Prisma.ModelName>(modelName: T) {
  /* eslint-disable @typescript-eslint/no-unsafe-declaration-merging */
  const lowerModelName = lowerFirst(modelName)

  @Injectable()
  class BaseElectionDbService implements OnModuleInit {
    @Inject()
    // NOTE: TS won't let me make this private when returning a class def
    // from a function
    readonly _electionDb!: ElectionDbService

    readonly logger = new Logger(this.constructor.name)

    get model(): ElectionDbPrismaClient[Uncapitalize<T>] {
      return this._electionDb.instance[lowerModelName]
    }

    get client(): ElectionDbPrismaClient {
      return this._electionDb.instance
    }

    onModuleInit() {
      // Resolve `this.model` on every call rather than binding once: the
      // client is built lazily in ElectionDbService.onModuleInit, and Nest
      // does not order that before this hook, so a one-time bind could
      // capture an uninitialized client.
      for (const method of PASSTHROUGH_MODEL_METHODS) {
        const thisWithMethod: Record<string, (...args: unknown[]) => unknown> =
          // Prisma delegate types are dynamically resolved — no static narrowing possible
          // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
          this as unknown as Record<string, (...args: unknown[]) => unknown>
        thisWithMethod[method] = (...args: unknown[]) =>
          // Prisma delegate types are dynamically resolved — no static narrowing possible
          // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
          (this.model[method] as (...a: unknown[]) => unknown)(...args)
      }
    }
  }

  // This interface merges with the class type to apply the prisma method
  // types to the class def
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  interface BaseElectionDbService extends Pick<
    ElectionDbPrismaClient[Uncapitalize<T>],
    (typeof PASSTHROUGH_MODEL_METHODS)[number]
  > {}

  return BaseElectionDbService
}

export function buildColumnSelect(columns: string) {
  return columns
    .split(',')
    .map((col) => col.trim())
    .reduce<Record<string, boolean>>((acc, col) => {
      acc[col] = true
      return acc
    }, {})
}
