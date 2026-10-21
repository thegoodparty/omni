import type { PrismaClient } from '../../../../generated/prisma'
import {
  seedChatOrgRows,
  type SeedChatOrgOptions,
  type SeededChatOrg,
} from '@/testFixtures/judgeChatFixture/seed'
import { assertTestProcess } from './chatSeam'

// THE IN-PROCESS SEAM OVER THE JUDGE'S CHAT FIXTURE, and the only thing on
// it is the guard. A vitest arm drives the app in its own process against a
// throwaway database, so it goes on seeding behind assertTestProcess exactly
// as it did.
//
// The fixture itself — the rows, the slug, the account states and the
// teardown — lives in src/testFixtures/judgeChatFixture/, so that a DEPLOYED
// arm can ask for the same rows over HTTP. It has to: this process check
// cannot hold on a preview, which runs the PR's image with
// NODE_ENV=production and no VITEST, and the arm has no Prisma client of its
// own to reach that database with. src/chats/evals/** is also excluded from
// the production build, so the fixture could not be reached from here at
// runtime even if the guard allowed it.
//
// The gates that replace this one over there are the endpoint's — see
// src/testFixtures/testFixturesJudge.controller.ts — and keeping them apart
// is the point: neither path can borrow the other's permission.
//
// `slugKey` is the caller's case id: unique per case within one run, and the
// same on both arms. `sweepId` is the run itself, which both arms also
// share — it keeps two sweeps on one database off each other's fixtures.
export const seedChatOrg = async (
  prisma: PrismaClient,
  userId: number,
  sweepId: string,
  agentId: string,
  slugKey: string,
  options: SeedChatOrgOptions = {},
): Promise<SeededChatOrg> => {
  // Inserts against whatever client it is handed, and the briefing seed also
  // deletes (see seedBriefing). A judge-prefixed organization owned by a real
  // user is not something to create outside a throwaway database.
  assertTestProcess('seedChatOrg')
  return seedChatOrgRows(prisma, userId, sweepId, agentId, slugKey, options)
}
