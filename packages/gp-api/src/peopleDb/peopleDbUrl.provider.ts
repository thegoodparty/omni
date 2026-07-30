import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common'
import { GetParameterCommand, SSMClient } from '@aws-sdk/client-ssm'

const REVALIDATE_INTERVAL_MS = 5 * 60 * 1000

type ChangeListener = (url: string) => void

@Injectable()
export class PeopleDbUrlProvider implements OnModuleDestroy {
  private readonly logger = new Logger(PeopleDbUrlProvider.name)
  private readonly listeners = new Set<ChangeListener>()
  private ssm: SSMClient | null = null
  private value: string | null = null
  private loadPromise: Promise<string> | null = null
  private interval: NodeJS.Timeout | null = null
  private revalidating = false

  // Lazy, memoized load. Consumers await this from their own onModuleInit
  // rather than reading a value that a separate onModuleInit populated —
  // Nest does not guarantee a dependency's onModuleInit runs before its
  // dependents' within the same module, so eager population would race.
  async ensureLoaded(): Promise<string> {
    if (this.value !== null) {
      return this.value
    }
    if (!this.loadPromise) {
      this.loadPromise = this.load()
    }
    // Schedule revalidation even when the first load fails: consumers'
    // onModuleInit is the only guaranteed caller, so without this a failed
    // boot load would never be retried and the process would serve
    // "client not initialized" errors until restarted (2026-07-29 prod
    // contacts outage).
    if (!this.interval) {
      this.interval = setInterval(() => {
        void this.revalidate()
      }, REVALIDATE_INTERVAL_MS)
    }
    try {
      this.value = await this.loadPromise
    } catch (err) {
      // Don't memoize a failed load — allow a later caller to retry.
      this.loadPromise = null
      throw err
    }
    this.logger.log('Loaded initial database URL')
    return this.value
  }

  onModuleDestroy() {
    if (this.interval) {
      clearInterval(this.interval)
    }
    // Close the SDK's keep-alive sockets so they don't hold the event loop
    // open and block a clean SIGTERM exit on ECS.
    this.ssm?.destroy()
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
    const local = process.env.PEOPLE_DATABASE_URL
    if (local) {
      return local
    }

    const override = process.env.PEOPLE_DB_SSM_PARAM
    const environment = process.env.OTEL_SERVICE_ENVIRONMENT
    if (!override && !environment) {
      throw new Error(
        'Cannot resolve database URL: set PEOPLE_DATABASE_URL for local ' +
          'development, or OTEL_SERVICE_ENVIRONMENT when running deployed',
      )
    }

    const name = override || `people-db-connection-string-${environment}`
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
