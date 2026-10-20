import { Injectable, ServiceUnavailableException } from '@nestjs/common'
import {
  DistrictResolverService,
  type DistrictResolution,
} from '@/chats/briefing-chats/services/districtResolver.service'
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
  constructor(private readonly districtResolver: DistrictResolverService) {
    super()
  }

  // IDEMPOTENT BY REMOVING FIRST, not by upserting. A sweep retries, and the
  // seeder creates rather than upserts — which the in-process arm relies on,
  // since a duplicate slug there is a real collision worth failing on. Over
  // HTTP the honest answer to "set this case up again" is the state the first
  // call produced, and tearing down first is what gives exactly that rather
  // than a second organization or a half-updated first one.
  async setUp(
    userId: number,
    { sweepId, agentId, slugKey, accountState }: SetUpJudgeChatCaseInput,
  ): Promise<SeededChatOrg & { district?: DistrictResolution }> {
    // Refuses a state the scope has no row for BEFORE anything is removed, so
    // a bad request cannot cost the caller the fixture it already had.
    const options = seedOptionsFor(agentId, accountState)
    await removeChatOrgFixture(
      this.client,
      userId,
      chatOrgSlug(sweepId, agentId, slugKey),
    )
    const seeded = await seedChatOrgRows(
      this.client,
      userId,
      sweepId,
      agentId,
      slugKey,
      options,
    )
    if (options.district === false) return seeded

    // A seeded positionId is only half the district gate; the other half is
    // this deployment's election-api answering for it. Checked here, before
    // the arm opens a conversation, because a district that does not resolve
    // drops the constituent tools without an error and the case would then
    // measure an agent with no district while recording one.
    const district = await this.districtResolver.resolveByOrgSlug(
      seeded.organizationSlug,
    )
    if (!district) {
      await removeChatOrgFixture(this.client, userId, seeded.organizationSlug)
      throw new ServiceUnavailableException(
        'the judge fixture position did not resolve to a district on this ' +
          'deployment, so the constituent tools would not register',
      )
    }
    return { ...seeded, district }
  }

  tearDown(userId: number, organizationSlug: string): Promise<boolean> {
    return removeChatOrgFixture(this.client, userId, organizationSlug)
  }
}
