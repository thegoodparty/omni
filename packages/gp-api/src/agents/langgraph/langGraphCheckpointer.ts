import { Injectable, OnApplicationShutdown } from '@nestjs/common'
import { PostgresSaver } from '@langchain/langgraph-checkpoint-postgres'
import { Pool } from 'pg'
import { requireEnv } from '@/shared/util/env.util'

export const LANGGRAPH_SCHEMA = 'langgraph'

// LangGraph's own working memory for a run in progress, in schema langgraph
// of the gp-api database (tables created by a Prisma migration, so setup()
// is never needed). Keyed by thread id: a background run's or a chat's
// ChatConversation id. Nothing the product reads lives here.
@Injectable()
export class LangGraphCheckpointer implements OnApplicationShutdown {
  private readonly pool: Pool
  readonly saver: PostgresSaver

  constructor() {
    // Read at construction: useTestService swaps DATABASE_URL per suite.
    this.pool = new Pool({
      connectionString: requireEnv('DATABASE_URL'),
      max: 5,
      application_name: 'gp-api-langgraph',
    })
    this.saver = new PostgresSaver(this.pool, undefined, {
      schema: LANGGRAPH_SCHEMA,
    })
  }

  // After every module's onModuleDestroy, so a run draining during the
  // shutdown grace can still write its last checkpoint.
  async onApplicationShutdown(): Promise<void> {
    await this.pool.end()
  }
}
