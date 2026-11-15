import type { PriorityGroupRead as GroupRead } from '../../src/priorities/util/priorityGroupRead.util'

export {}

declare global {
  export namespace PrismaJson {
    // Null when the district could not be read.
    export type PriorityGroupRead = GroupRead
  }
}
