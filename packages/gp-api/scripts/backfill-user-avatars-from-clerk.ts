/**
 * Backfill Clerk-hosted avatars into our own assets bucket.
 *
 * For every user linked to Clerk that has no avatar of ours, reads the Clerk
 * profile image and copies it into S3 via UserAvatarService, then writes our
 * URL onto the row so Postgres becomes the authoritative source.
 *
 * Most candidates turn out to have no Clerk image at all, and we can't know
 * which without asking, so the Clerk reads are batched: one throttled
 * getUserList per CLERK_BATCH_SIZE ids rather than one call per candidate.
 *
 * Idempotent: a row with a non-empty avatar is never selected, so a re-run
 * only picks up what an earlier pass could not fill.
 *
 * Usage (NOT tsx: esbuild drops emitDecoratorMetadata, so every Nest provider
 * would be constructed with undefined dependencies):
 *   node -r @swc-node/register -r tsconfig-paths/register \
 *     scripts/backfill-user-avatars-from-clerk.ts --dry-run
 *   node -r @swc-node/register -r tsconfig-paths/register \
 *     scripts/backfill-user-avatars-from-clerk.ts
 *
 * Required env vars:
 *   DATABASE_URL, CLERK_SECRET_KEY, GP_API_MACHINE_SECRET,
 *   AGENT_MCP_TOKEN_SECRET, AUTH_SECRET, ASSET_DOMAIN, plus AWS credentials
 *   with write access to the assets bucket.
 */
import '../src/configrc'

import { Module } from '@nestjs/common'
import { NestFactory } from '@nestjs/core'
import { type ClerkClient } from '@clerk/backend'
import { Prisma } from '../src/generated/prisma'
import { loggerModule } from '../src/observability/logging/logger-module'
import { PrismaModule } from '../src/prisma/prisma.module'
import { PrismaService } from '../src/prisma/prisma.service'
import { UserAvatarService } from '../src/users/services/userAvatar.service'
import { AwsModule } from '../src/vendors/aws/aws.module'
import { ClerkModule } from '../src/vendors/clerk/clerk.module'
import { CLERK_CLIENT_PROVIDER_TOKEN } from '../src/vendors/clerk/providers/clerk-client.provider'
import { clerkThrottle } from '../src/vendors/clerk/util/clerkThrottle.util'

const PROGRESS_INTERVAL = 100

// Clerk takes these ids as repeated user_id query params, so the batch size is
// a URL-length budget rather than a page size: at ~32 chars per id, 100 ids is
// a ~4KB URL, while 500 would be ~20KB and risks a server URL-length limit.
const CLERK_BATCH_SIZE = 100

type AvatarBackfillRow = {
  clerkId: string | null
  avatar: string | null
}

export const isEligibleForAvatarBackfill = <T extends AvatarBackfillRow>(
  user: T,
): user is T & { clerkId: string } => !!user.clerkId && !user.avatar?.trim()

type ClerkBatchUser = {
  id: string
  hasImage: boolean
  imageUrl: string
}

type AvatarLookupOutcome =
  | { status: 'image'; url: string }
  | { status: 'noImage' }
  | { status: 'providerMiss' }

/**
 * An id we asked about but Clerk did not return is a deleted user, which is a
 * provider miss — never a live user who happens to have no image.
 */
export const mapClerkBatchToOutcomes = (
  requestedIds: string[],
  clerkUsers: ClerkBatchUser[],
): Map<string, AvatarLookupOutcome> => {
  const byId = new Map(clerkUsers.map((user) => [user.id, user]))

  return new Map(
    requestedIds.map((id): [string, AvatarLookupOutcome] => {
      const clerkUser = byId.get(id)
      if (!clerkUser) return [id, { status: 'providerMiss' }]
      if (!clerkUser.hasImage) return [id, { status: 'noImage' }]
      return [id, { status: 'image', url: clerkUser.imageUrl }]
    }),
  )
}

// AppModule is deliberately not used: it registers every @Cron job and, outside
// NODE_ENV=test, the SQS consumer, which would start draining the real queue
// onto whichever machine runs this backfill.
@Module({
  imports: [loggerModule, PrismaModule, AwsModule, ClerkModule],
  providers: [UserAvatarService],
})
class AvatarBackfillModule {}

const main = async () => {
  const dryRun = process.argv.includes('--dry-run')
  const app = await NestFactory.createApplicationContext(AvatarBackfillModule, {
    logger: ['error', 'warn'],
  })

  let ingested = 0
  let noImage = 0
  let providerMiss = 0
  let raceLost = 0
  let failed = 0
  let processed = 0

  try {
    const prisma = app.get(PrismaService)
    const avatars = app.get(UserAvatarService)
    const clerk = app.get<ClerkClient>(CLERK_CLIENT_PROVIDER_TOKEN)

    const candidates = await prisma.user.findMany({
      where: { clerkId: { not: null }, OR: [{ avatar: null }, { avatar: '' }] },
      select: { id: true, clerkId: true, avatar: true },
      orderBy: { id: Prisma.SortOrder.asc },
    })

    console.log(
      `${candidates.length} candidate users` + (dryRun ? ' (dry run)' : ''),
    )

    for (let start = 0; start < candidates.length; start += CLERK_BATCH_SIZE) {
      const batch = candidates.slice(start, start + CLERK_BATCH_SIZE)
      const eligible = batch.filter(isEligibleForAvatarBackfill)
      const clerkIds = eligible.map((row) => row.clerkId)

      let outcomes = new Map<string, AvatarLookupOutcome>()
      if (clerkIds.length > 0) {
        try {
          const page = await clerkThrottle(() =>
            clerk.users.getUserList({
              userId: clerkIds,
              limit: clerkIds.length,
            }),
          )
          outcomes = mapClerkBatchToOutcomes(clerkIds, page.data)
        } catch (err) {
          // The whole request failed, so every id in it is unknown, not
          // imageless. Counting these as noImage would let a total Clerk
          // outage report as a clean run.
          outcomes = mapClerkBatchToOutcomes(clerkIds, [])
          console.error(
            `  Clerk batch of ${clerkIds.length} failed, counting as ` +
              'provider misses:',
            err,
          )
        }
      }

      for (const row of eligible) {
        const outcome = outcomes.get(row.clerkId) ?? {
          status: 'providerMiss' as const,
        }
        if (outcome.status === 'providerMiss') {
          providerMiss += 1
          continue
        }
        if (outcome.status === 'noImage') {
          noImage += 1
          continue
        }
        if (dryRun) {
          ingested += 1
          continue
        }

        const url = await avatars.ingestFromUrl(row.id, outcome.url)
        if (!url) {
          failed += 1
          continue
        }

        // Candidates are read once up front, so re-check "still empty" at
        // write time: a self-upload via POST /v1/users/me/upload-image after
        // the read must not be overwritten. Both NULL and '' mean no avatar.
        const written = await prisma.user.updateMany({
          where: { id: row.id, OR: [{ avatar: null }, { avatar: '' }] },
          data: { avatar: url },
        })
        if (written.count > 0) ingested += 1
        else raceLost += 1
      }

      processed += batch.length
      if (
        processed % PROGRESS_INTERVAL === 0 ||
        processed === candidates.length
      ) {
        console.log(
          `  ${processed}/${candidates.length}: ${ingested} ingested, ` +
            `${noImage} no image, ${providerMiss} provider miss, ` +
            `${failed} failed`,
        )
      }
    }

    console.log(
      JSON.stringify(
        {
          dryRun,
          candidates: candidates.length,
          ingested,
          noImage,
          providerMiss,
          raceLost,
          failed,
        },
        null,
        2,
      ),
    )
  } finally {
    await app.close()
  }
}

if (process.argv[1]?.includes('backfill-user-avatars-from-clerk')) {
  main().catch((err) => {
    console.error('Avatar backfill failed:', err)
    process.exit(1)
  })
}
