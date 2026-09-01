/**
 * Backfill Clerk-hosted avatars into our own assets bucket.
 *
 * For every user linked to Clerk that has no avatar of ours, reads the Clerk
 * profile image and copies it into S3 via UserAvatarService, then writes our
 * URL onto the row so Postgres becomes the authoritative source.
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
import {
  AUTH_PROVIDER_TOKEN,
  type AuthProvider,
} from '../src/authentication/interfaces/auth-provider.interface'
import { Prisma } from '../src/generated/prisma'
import { loggerModule } from '../src/observability/logging/logger-module'
import { PrismaModule } from '../src/prisma/prisma.module'
import { PrismaService } from '../src/prisma/prisma.service'
import { UserAvatarService } from '../src/users/services/userAvatar.service'
import { AwsModule } from '../src/vendors/aws/aws.module'
import { ClerkModule } from '../src/vendors/clerk/clerk.module'
import { clerkThrottle } from '../src/vendors/clerk/util/clerkThrottle.util'

const PROGRESS_INTERVAL = 100

type AvatarBackfillRow = {
  clerkId: string | null
  avatar: string | null
}

export const isEligibleForAvatarBackfill = <T extends AvatarBackfillRow>(
  user: T,
): user is T & { clerkId: string } => !!user.clerkId && !user.avatar?.trim()

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
  let failed = 0
  let processed = 0

  try {
    const prisma = app.get(PrismaService)
    const avatars = app.get(UserAvatarService)
    const auth = app.get<AuthProvider>(AUTH_PROVIDER_TOKEN)

    const candidates = await prisma.user.findMany({
      where: { clerkId: { not: null }, OR: [{ avatar: null }, { avatar: '' }] },
      select: { id: true, clerkId: true, avatar: true },
      orderBy: { id: Prisma.SortOrder.asc },
    })

    console.log(
      `${candidates.length} candidate users` + (dryRun ? ' (dry run)' : ''),
    )

    for (const row of candidates) {
      processed += 1
      if (processed % PROGRESS_INTERVAL === 0) {
        console.log(
          `  ${processed}/${candidates.length}: ${ingested} ingested, ` +
            `${noImage} no image, ${providerMiss} provider miss, ` +
            `${failed} failed`,
        )
      }

      if (!isEligibleForAvatarBackfill(row)) continue

      const providerUser = await clerkThrottle(() => auth.getUser(row.clerkId))
      // getUser swallows its own errors and returns null, so this bucket means
      // "Clerk had nothing for us" (a deleted user, or a failed read) and is
      // kept apart from a live user who simply has no image.
      if (!providerUser) {
        providerMiss += 1
        continue
      }
      if (!providerUser.avatarUrl) {
        noImage += 1
        continue
      }
      if (dryRun) {
        ingested += 1
        continue
      }

      const url = await avatars.ingestFromUrl(row.id, providerUser.avatarUrl)
      if (!url) {
        failed += 1
        continue
      }

      await prisma.user.update({
        where: { id: row.id },
        data: { avatar: url },
      })
      ingested += 1
    }

    console.log(
      JSON.stringify(
        {
          dryRun,
          candidates: candidates.length,
          ingested,
          noImage,
          providerMiss,
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
