import { Injectable } from '@nestjs/common'
import { CacheControls, MimeTypes } from 'http-constants-ts'
import { PinoLogger } from 'nestjs-pino'
import { ASSET_DOMAIN } from 'src/shared/util/appEnvironment.util'
import { S3Service } from '@/vendors/aws/services/s3.service'

const MAX_AVATAR_BYTES = 5 * 1024 * 1024
const FETCH_TIMEOUT_MS = 10_000

const EXTENSIONS: Record<string, string> = {
  [MimeTypes.IMAGE_PNG]: 'png',
  [MimeTypes.IMAGE_JPEG]: 'jpg',
  [MimeTypes.IMAGE_GIF]: 'gif',
  [MimeTypes.IMAGE_WEBP]: 'webp',
}

@Injectable()
export class UserAvatarService {
  constructor(
    private readonly s3: S3Service,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(UserAvatarService.name)
  }

  // Copies a provider-hosted image (Clerk, which itself copied it from Google
  // or Facebook) into our own bucket so Postgres can be the authoritative
  // store. Returns null on any failure: an absent avatar is a cosmetic loss
  // and must never fail the caller's request or backfill row.
  async ingestFromUrl(
    userId: number,
    sourceUrl: string,
  ): Promise<string | null> {
    try {
      const resp = await fetch(sourceUrl, {
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      })
      if (!resp.ok) {
        this.logger.warn(
          { userId, status: resp.status },
          'Avatar source returned non-ok',
        )
        return null
      }

      const contentType =
        (resp.headers.get('content-type') ?? '').split(';')[0] ?? ''
      const extension = EXTENSIONS[contentType]
      if (!extension) {
        this.logger.warn(
          { userId, contentType },
          'Avatar source is not a supported image type',
        )
        return null
      }

      const declared = Number(resp.headers.get('content-length') ?? 0)
      if (declared > MAX_AVATAR_BYTES) {
        this.logger.warn({ userId, declared }, 'Avatar source too large')
        return null
      }

      if (!resp.body) {
        this.logger.warn({ userId }, 'Avatar source returned no body')
        return null
      }

      // The content-length check above is only a cheap pre-filter: chunked and
      // redirected CDN responses routinely omit the header, and this runs in
      // the API process on the provisioning path, so an unbounded
      // arrayBuffer() would let a hostile or broken source decide our heap
      // usage. Read incrementally and abandon the response the moment it
      // crosses the cap.
      // Annotated because the ambient Response types body as
      // ReadableStream<any>, which would make every read() result untyped.
      const reader: ReadableStreamDefaultReader<Uint8Array> =
        resp.body.getReader()
      const chunks: Buffer[] = []
      let total = 0
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        total += value.byteLength
        if (total > MAX_AVATAR_BYTES) {
          await reader.cancel()
          this.logger.warn(
            { userId, bytes: total },
            'Avatar body exceeded the size cap',
          )
          return null
        }
        chunks.push(Buffer.from(value))
      }
      const body = Buffer.concat(chunks)

      const key = this.s3.buildKey(`uploads/${userId}`, `avatar.${extension}`)
      return await this.s3.uploadFile(ASSET_DOMAIN, body, key, {
        contentType,
        cacheControl: `${CacheControls.MAX_AGE}=${31_536_000}`,
        baseUrl: `https://${ASSET_DOMAIN}`,
      })
    } catch (err) {
      this.logger.warn({ err, userId }, 'Avatar ingestion failed')
      return null
    }
  }
}
