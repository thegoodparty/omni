import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common'
import { lowerFirst } from 'lodash'
import { Prisma } from '../generated/people-prisma'
import { PeopleDbPrismaClient, PeopleDbService } from './peopleDb.service'

export const PEOPLE_MODELS = Prisma.ModelName

type ExcludeTypes = `$${string}` | symbol
type PeopleDbModels = Exclude<keyof PeopleDbPrismaClient, ExcludeTypes>
type PeopleDbMethods = Exclude<
  keyof PeopleDbPrismaClient[PeopleDbModels],
  ExcludeTypes
>

// These are methods that should be avaialable as public methods on any
// people-db model service, e.g. this.someVoterService.findMany(...args) --
// this allows us to avoid manually redeclaring types when we just want to
// make a prisma method available directly
const PASSTHROUGH_MODEL_METHODS = [
  'findMany',
  'findFirst',
  'findFirstOrThrow',
  'findUnique',
  'findUniqueOrThrow',
  'count',
] satisfies PeopleDbMethods[]

export function createPeopleDbBase<T extends Prisma.ModelName>(modelName: T) {
  /* eslint-disable @typescript-eslint/no-unsafe-declaration-merging */
  const lowerModelName = lowerFirst(modelName)

  @Injectable()
  class BasePeopleDbService implements OnModuleInit {
    @Inject()
    // NOTE: TS won't let me make this private when returning a class def
    // from a function
    readonly _peopleDb!: PeopleDbService

    readonly logger = new Logger(this.constructor.name)

    get model(): PeopleDbPrismaClient[Uncapitalize<T>] {
      return this._peopleDb.instance[lowerModelName]
    }

    get client(): PeopleDbPrismaClient {
      return this._peopleDb.instance
    }

    onModuleInit() {
      // Resolve `this.model` on every call rather than binding once: the
      // underlying Prisma client is rebuilt and swapped when the database
      // URL changes, so a one-time bind would leave these pointed at a
      // disconnected client after a swap.
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
  interface BasePeopleDbService extends Pick<
    PeopleDbPrismaClient[Uncapitalize<T>],
    (typeof PASSTHROUGH_MODEL_METHODS)[number]
  > {}

  return BasePeopleDbService
}
