import { Injectable } from '@nestjs/common'
import { createPrismaBase, MODELS } from '@/prisma/util/prisma.util'
import {
  chatOrgSlug,
  seedChatOrgRows,
  seedOptionsFor,
  type SeededChatOrg,
} from '../judgeChatFixture/seed'
import { removeChatOrgFixture } from '../judgeChatFixture/teardown'
import type { SetUpJudgeChatCaseInput } from '../schemas/judgeChatFixture.schema'

// The judge's chat fixture, prepared over HTTP for an arm that runs against a
// deployed preview and so has no Prisma client of its own. The rows are the
// in-process arm's rows — seedChatOrgRows is the same function behind both —
// and nothing about the fixture is decided here.
@Injectable()
export class JudgeChatFixtureService extends createPrismaBase(
  MODELS.Organization,
) {
  // IDEMPOTENT BY REMOVING FIRST, not by upserting. A sweep retries, and the
  // seeder creates rather than upserts — which the in-process arm relies on,
  // since a duplicate slug there is a real collision worth failing on. Over
  // HTTP the honest answer to "set this case up again" is the state the first
  // call produced, and tearing down first is what gives exactly that rather
  // than a second organization or a half-updated first one.
  async setUp(
    userId: number,
    { agentId, slugKey, accountState }: SetUpJudgeChatCaseInput,
  ): Promise<SeededChatOrg> {
    // Refuses a state the scope has no row for BEFORE anything is removed, so
    // a bad request cannot cost the caller the fixture it already had.
    const options = seedOptionsFor(agentId, accountState)
    await removeChatOrgFixture(
      this.client,
      userId,
      chatOrgSlug(agentId, slugKey),
    )
    return seedChatOrgRows(this.client, userId, agentId, slugKey, options)
  }

  tearDown(userId: number, organizationSlug: string): Promise<boolean> {
    return removeChatOrgFixture(this.client, userId, organizationSlug)
  }
}
