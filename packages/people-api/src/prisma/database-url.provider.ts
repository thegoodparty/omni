import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common'
import { GetParameterCommand, SSMClient } from '@aws-sdk/client-ssm'

const REVALIDATE_INTERVAL_MS = 5 * 60 * 1000

type ChangeListener = (url: string) => void

@Injectable()
export class DatabaseUrlProvider implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DatabaseUrlProvider.name)
  private readonly listeners = new Set<ChangeListener>()
  private ssm: SSMClient | null = null
  private value: string | null = null
  private interval: NodeJS.Timeout | null = null
  private revalidating = false

  async onModuleInit() {
    this.value = await this.load()
    this.logger.log('Loaded initial database URL')
    this.interval = setInterval(() => {
      void this.revalidate()
    }, REVALIDATE_INTERVAL_MS)
  }

  onModuleDestroy() {
    if (this.interval) {
      clearInterval(this.interval)
    }
    // Close the SDK's keep-alive sockets so they don't hold the event loop open
    // and block a clean SIGTERM exit on ECS.
    this.ssm?.destroy()
  }

  get current(): string {
    if (this.value === null) {
      throw new Error('DatabaseUrlProvider accessed before initialization')
    }
    return this.value
  }

  onChange(listener: ChangeListener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private async revalidate() {
    if (this.revalidating) {
      return
    }
    this.revalidating = true
    try {
      const next = await this.load()
      if (next !== this.value) {
        this.logger.log('Database URL changed, notifying subscribers')
        this.value = next
        for (const listener of this.listeners) {
          listener(next)
        }
      }
    } catch (err) {
      // Never take down a healthy process on a transient SSM failure — keep
      // serving the last-known-good value and try again next interval.
      this.logger.error({ err }, 'Failed to revalidate database URL')
    } finally {
      this.revalidating = false
    }
  }

  private async load(): Promise<string> {
    const local = process.env.LOCAL_DATABASE_URL
    if (local) {
      return local
    }

    const environment = process.env.OTEL_SERVICE_ENVIRONMENT
    if (!environment) {
      throw new Error(
        'Cannot resolve database URL: set LOCAL_DATABASE_URL for local ' +
          'development, or OTEL_SERVICE_ENVIRONMENT when running deployed',
      )
    }

    const name = `people-db-connection-string-${environment}`
    if (!this.ssm) {
      this.ssm = new SSMClient({ region: process.env.AWS_REGION })
    }

    const result = await this.ssm.send(
      new GetParameterCommand({ Name: name, WithDecryption: true }),
    )
    const url = result.Parameter?.Value
    if (!url) {
      throw new Error(`SSM parameter ${name} has no value`)
    }
    return url
  }
}
