import { RecommendedLists } from '@goodparty_org/contracts'

export {}

declare global {
  export namespace PrismaJson {
    export type RecommendedListsPayload = RecommendedLists
  }
}
