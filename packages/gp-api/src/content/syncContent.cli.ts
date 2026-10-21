/**
 * Pulls Contentful into the `content` table.
 *
 * The sync is nine Contentful reads and one long transaction that rewrites the
 * table, and the only thing that asks for it is a preview deploy bringing a
 * fresh database up to date. It runs here, as its own process against the Nest
 * application context, rather than over HTTP, so the work is reachable only
 * from inside the deploy and the route that used to trigger it does not have to
 * be open to anyone who can reach the service.
 *
 * Compiled with the app rather than run through tsx: esbuild drops
 * `emitDecoratorMetadata`, so every Nest provider would be constructed with
 * undefined dependencies.
 *
 *   node dist/content/syncContent.cli.js
 */
import '../configrc'

import { Module } from '@nestjs/common'
import { NestFactory } from '@nestjs/core'
import { loggerModule } from '../observability/logging/logger-module'
import { PrismaModule } from '../prisma/prisma.module'
import { SharedModule } from '../shared/shared.module'
import { ContentModule } from './content.module'
import { ContentService } from './services/content.service'

// AppModule is deliberately not used: it registers every @Cron job and,
// outside NODE_ENV=test, the SQS consumer, which would start draining the real
// queue onto whichever task runs this sync.
@Module({
  imports: [loggerModule, PrismaModule, SharedModule, ContentModule],
})
class ContentSyncModule {}

const main = async (): Promise<void> => {
  const app = await NestFactory.createApplicationContext(ContentSyncModule, {
    logger: ['error', 'warn'],
  })

  try {
    const { entries, createEntries, updateEntries, deletedEntries } = await app
      .get(ContentService)
      .syncContent()

    console.log(
      JSON.stringify({
        entriesCount: entries.length,
        createEntriesCount: createEntries.length,
        updateEntriesCount: updateEntries.length,
        deletedEntriesCount: deletedEntries.length,
      }),
    )
  } finally {
    await app.close()
  }
}

if (process.argv[1]?.includes('syncContent.cli')) {
  main().catch((err) => {
    console.error('Content sync failed:', err)
    process.exit(1)
  })
}
