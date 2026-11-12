import type { MrpRead } from '../../src/priorities/util/mrpReadStatus.util'

export {}

declare global {
  export namespace PrismaJson {
    // Null when the district could not be read or is too large to model.
    export type PriorityMrpRead = MrpRead
  }
}
