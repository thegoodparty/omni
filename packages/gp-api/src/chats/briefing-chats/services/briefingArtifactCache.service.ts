import {
  BadGatewayException,
  HttpException,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import { PinoLogger } from 'nestjs-pino'
import { S3Service } from '@/vendors/aws/services/s3.service'

export const TTL_MS = 900_000 as const
export const MAX_ENTRIES = 50 as const
export const MAX_ARTIFACT_BYTES = 1_048_576 as const

interface CacheEntry {
  value: string
  expiresAt: number
}

@Injectable()
export class BriefingArtifactCacheService {
  private readonly cache = new Map<string, CacheEntry>()
  private readonly inflight = new Map<string, Promise<string>>()

  constructor(
    private readonly s3Service: S3Service,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(BriefingArtifactCacheService.name)
  }

  async get(bucket: string, key: string): Promise<string> {
    const cacheKey = `${bucket}/${key}`
    const cached = this.cache.get(cacheKey)
    if (cached && cached.expiresAt > Date.now()) {
      this.cache.delete(cacheKey)
      this.cache.set(cacheKey, cached)
      return cached.value
    }
    const existing = this.inflight.get(cacheKey)
    if (existing) return existing
    const promise = this.fetchAndCache(bucket, key, cacheKey)
    this.inflight.set(cacheKey, promise)
    try {
      return await promise
    } finally {
      this.inflight.delete(cacheKey)
    }
  }

  private async fetchAndCache(
    bucket: string,
    key: string,
    cacheKey: string,
  ): Promise<string> {
    const body = await this.fetchFromS3(bucket, key)
    this.evictIfFull()
    this.cache.set(cacheKey, { value: body, expiresAt: Date.now() + TTL_MS })
    return body
  }

  private async fetchFromS3(bucket: string, key: string): Promise<string> {
    let body: string | undefined
    try {
      body = await this.s3Service.getFile(bucket, key)
    } catch (err) {
      this.logger.error(
        { err, bucket, key },
        'failed to fetch briefing artifact from S3',
      )
      // S3Service already decided who was at fault for anything S3 answered:
      // our own bad request is a 500, an AWS outage a 502. Flattening all of
      // it back to 502 here is what kept the briefing tab retrying a wrong
      // bucket forever. Only a failure that never reached S3 at all — a
      // transport error the SDK never classified — is a gateway failure.
      if (err instanceof HttpException) throw err
      throw new BadGatewayException('Failed to fetch briefing artifact from S3')
    }
    if (body === undefined) {
      throw new NotFoundException('Briefing artifact missing')
    }
    if (Buffer.byteLength(body, 'utf8') > MAX_ARTIFACT_BYTES) {
      this.logger.warn(
        { bucket, key, size: Buffer.byteLength(body, 'utf8') },
        'briefing artifact exceeds size limit',
      )
      throw new BadGatewayException('Briefing artifact too large')
    }
    return body
  }

  private evictIfFull(): void {
    if (this.cache.size < MAX_ENTRIES) return
    const oldestKey = this.cache.keys().next().value
    if (oldestKey !== undefined) this.cache.delete(oldestKey)
  }
}
