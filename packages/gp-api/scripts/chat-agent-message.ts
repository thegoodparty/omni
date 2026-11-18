/**
 * Copy every chat conversation's ChatMessage rows onto AgentMessage, or
 * check the two read the same. The hourly chatAgentMessageBackfill schedule
 * runs both; this runs them now. Idempotent. Prints ids and counts only.
 *
 * Usage (NOT tsx: esbuild drops emitDecoratorMetadata):
 *   node -r @swc-node/register -r tsconfig-paths/register \
 *     scripts/chat-agent-message.ts backfill
 *   node -r @swc-node/register -r tsconfig-paths/register \
 *     scripts/chat-agent-message.ts parity [--sample 200]
 *
 * Required env vars: DATABASE_URL.
 */
import '../src/configrc'

import { Module } from '@nestjs/common'
import { NestFactory } from '@nestjs/core'
import { ChatAgentMessageBackfillService } from '../src/chats/services/chatAgentMessageBackfill.service'
import { ChatStoreService } from '../src/chats/services/chatStore.prisma'
import { FeaturesService } from '../src/features/services/features.service'
import { loggerModule } from '../src/observability/logging/logger-module'
import { PrismaModule } from '../src/prisma/prisma.module'

// Neither command reads the flag; the store only needs it for reads.
@Module({
  imports: [loggerModule, PrismaModule],
  providers: [
    ChatStoreService,
    ChatAgentMessageBackfillService,
    {
      provide: FeaturesService,
      useValue: { isGlobalFeatureEnabled: async () => false },
    },
  ],
})
class ChatAgentMessageModule {}

const main = async () => {
  const command = process.argv[2]
  if (command !== 'backfill' && command !== 'parity') {
    throw new Error('usage: chat-agent-message.ts backfill|parity [--sample N]')
  }
  const sampleFlag = process.argv.indexOf('--sample')
  const sample = sampleFlag > 0 ? Number(process.argv[sampleFlag + 1]) : 50
  const app = await NestFactory.createApplicationContext(
    ChatAgentMessageModule,
    { logger: ['error', 'warn'] },
  )
  try {
    const service = app.get(ChatAgentMessageBackfillService)
    const result =
      command === 'backfill'
        ? await service.backfill()
        : await service.parity(sample)
    console.log(JSON.stringify(result, null, 2))
  } finally {
    await app.close()
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err))
  process.exit(1)
})
