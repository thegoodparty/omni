import {
  DeleteObjectsCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  ListObjectVersionsCommand,
  NoSuchKey,
  ObjectIdentifier,
  PutObjectCommand,
  PutObjectCommandInput,
  S3Client,
} from '@aws-sdk/client-s3'
import { Upload } from '@aws-sdk/lib-storage'
import { createPresignedPost } from '@aws-sdk/s3-presigned-post'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { BadGatewayException, Injectable } from '@nestjs/common'
import slugify from 'slugify'
import { Readable } from 'stream'
import { AwsService } from './aws.service'
import { PinoLogger } from 'nestjs-pino'

const { AWS_REGION: region = 'us-west-2' } = process.env
const EXPIRES_IN_DEFAULT = 3600 // 1 hour
const DELETE_OBJECTS_MAX_KEYS = 1000

const isHttpStatusError = (error: unknown, status: number): boolean => {
  if (typeof error !== 'object' || error === null) return false
  if (!('$metadata' in error)) return false
  const meta = (error as { $metadata?: unknown }).$metadata
  if (typeof meta !== 'object' || meta === null) return false
  if (!('httpStatusCode' in meta)) return false
  return (meta as { httpStatusCode?: unknown }).httpStatusCode === status
}

export type UploadFileOptions = {
  cacheControl?: string
  contentType?: string
  metadata?: Record<string, string>
  baseUrl?: string
}

export type GetSignedUrlOptions = {
  expiresIn?: number
  contentType?: string
}

export type PresignedUploadOptions = {
  expiresIn?: number
  contentType: string
  maxBytes: number
}

export type SizedUploadOptions = {
  expiresIn: number
  contentType: string
  contentLength: number
}

export type BuildKeyOptions = {
  slugifyFileName?: boolean
}

@Injectable()
export class S3Service extends AwsService {
  private readonly s3Client: S3Client
  // The default client puts the CRC32 of an empty body into a presigned PUT
  // URL, and S3 checks it against the real file. This one adds a checksum
  // only when the operation requires one.
  private readonly presignClient: S3Client

  constructor(protected readonly logger: PinoLogger) {
    super(logger)
    this.s3Client = new S3Client({ region })
    this.presignClient = new S3Client({
      region,
      requestChecksumCalculation: 'WHEN_REQUIRED',
    })
  }

  buildKey(
    folderPath?: string,
    fileName?: string,
    options?: BuildKeyOptions,
  ): string {
    const slugifyFileName = options?.slugifyFileName ?? true
    let processedFileName = fileName
    if (slugifyFileName && fileName) {
      processedFileName = slugify(fileName, { lower: true, trim: true })
    }

    if (!folderPath && !processedFileName) {
      return ''
    }
    if (!folderPath) {
      return processedFileName || ''
    }
    if (!processedFileName) {
      return folderPath.endsWith('/') ? folderPath : `${folderPath}/`
    }
    const normalizedFolder = folderPath.endsWith('/')
      ? folderPath
      : `${folderPath}/`
    return `${normalizedFolder}${processedFileName}`
  }

  private buildUrl(bucket: string, key: string, baseUrl?: string): string {
    if (baseUrl) {
      const normalizedBaseUrl = baseUrl.endsWith('/')
        ? baseUrl.slice(0, -1)
        : baseUrl
      return `${normalizedBaseUrl}/${key}`
    }
    return `https://${bucket}.s3.${region}.amazonaws.com/${key}`
  }

  async uploadFile(
    bucket: string,
    fileObject: PutObjectCommandInput['Body'],
    key: string,
    options?: UploadFileOptions,
  ) {
    return this.executeAwsOperation(async () => {
      const upload = new Upload({
        client: this.s3Client,
        params: {
          Bucket: bucket,
          Key: key,
          Body: fileObject,
          ContentType: options?.contentType,
          CacheControl: options?.cacheControl,
          Metadata: options?.metadata,
        },
      })

      const response = await upload.done()
      return this.buildUrl(bucket, response.Key || key, options?.baseUrl)
    }, 'uploadFile')
  }

  async getSignedUrlForUpload(
    bucket: string,
    key: string,
    options?: GetSignedUrlOptions,
  ) {
    return this.executeAwsOperation(async () => {
      return await getSignedUrl(
        this.s3Client,
        new PutObjectCommand({
          Bucket: bucket,
          Key: key,
          ContentType: options?.contentType,
        }),
        { expiresIn: options?.expiresIn || EXPIRES_IN_DEFAULT },
      )
    }, 'getSignedUrlForUpload')
  }

  // Presigned PUT with the length and type as signed headers, so S3 refuses
  // any body other than the one the caller declared.
  async getSignedUrlForSizedUpload(
    bucket: string,
    key: string,
    options: SizedUploadOptions,
  ) {
    return this.executeAwsOperation(async () => {
      return await getSignedUrl(
        this.presignClient,
        new PutObjectCommand({
          Bucket: bucket,
          Key: key,
          ContentType: options.contentType,
          ContentLength: options.contentLength,
        }),
        {
          expiresIn: options.expiresIn,
          signableHeaders: new Set(['content-type']),
        },
      )
    }, 'getSignedUrlForSizedUpload')
  }

  // Presigned POST (not PUT): the policy's content-length-range lets S3 reject
  // an oversize upload at upload time, which a presigned PUT URL can't express.
  // Returns the form `url` + `fields` the browser submits alongside the file.
  async createPresignedUpload(
    bucket: string,
    key: string,
    options: PresignedUploadOptions,
  ) {
    return this.executeAwsOperation(async () => {
      return await createPresignedPost(this.s3Client, {
        Bucket: bucket,
        Key: key,
        Conditions: [
          ['content-length-range', 1, options.maxBytes],
          { 'Content-Type': options.contentType },
        ],
        Fields: { 'Content-Type': options.contentType },
        Expires: options.expiresIn ?? EXPIRES_IN_DEFAULT,
      })
    }, 'createPresignedUpload')
  }

  async getSignedUrlForViewing(
    bucket: string,
    key: string,
    options?: GetSignedUrlOptions,
  ) {
    return this.executeAwsOperation(async () => {
      return await getSignedUrl(
        this.s3Client,
        new GetObjectCommand({
          Bucket: bucket,
          Key: key,
        }),
        { expiresIn: options?.expiresIn || EXPIRES_IN_DEFAULT },
      )
    }, 'getSignedUrlForViewing')
  }

  async getFile(bucket: string, key: string): Promise<string | undefined> {
    return this.executeAwsOperation(async () => {
      try {
        const response = await this.s3Client.send(
          new GetObjectCommand({
            Bucket: bucket,
            Key: key,
          }),
        )
        return response.Body?.transformToString()
      } catch (error) {
        if (error instanceof NoSuchKey) return undefined
        // S3 GET on a missing key surfaces as either NoSuchKey or a plain
        // 404 depending on permissions (no s3:ListBucket, NoSuchBucket);
        // treat both as "missing" — mirrors objectExists / headObject.
        if (isHttpStatusError(error, 404)) return undefined
        throw error
      }
    }, 'getFile')
  }

  async getFileBytes(bucket: string, key: string): Promise<Buffer | undefined> {
    return this.executeAwsOperation(async () => {
      try {
        const response = await this.s3Client.send(
          new GetObjectCommand({
            Bucket: bucket,
            Key: key,
          }),
        )
        const bytes = await response.Body?.transformToByteArray()
        return bytes ? Buffer.from(bytes) : undefined
      } catch (error) {
        if (error instanceof NoSuchKey) return undefined
        if (isHttpStatusError(error, 404)) return undefined
        throw error
      }
    }, 'getFileBytes')
  }

  async getFileStream(
    bucket: string,
    key: string,
  ): Promise<Readable | undefined> {
    return this.executeAwsOperation(async () => {
      try {
        const response = await this.s3Client.send(
          new GetObjectCommand({
            Bucket: bucket,
            Key: key,
          }),
        )
        return response.Body instanceof Readable ? response.Body : undefined
      } catch (error) {
        if (error instanceof NoSuchKey) return undefined
        if (isHttpStatusError(error, 404)) return undefined
        throw error
      }
    }, 'getFileStream')
  }

  async getRangeBytes(
    bucket: string,
    key: string,
    start: number,
    end: number,
  ): Promise<Buffer | undefined> {
    return this.executeAwsOperation(async () => {
      try {
        const response = await this.s3Client.send(
          new GetObjectCommand({
            Bucket: bucket,
            Key: key,
            Range: `bytes=${start}-${end}`,
          }),
        )
        const bytes = await response.Body?.transformToByteArray()
        return bytes ? Buffer.from(bytes) : undefined
      } catch (error) {
        if (error instanceof NoSuchKey) return undefined
        if (isHttpStatusError(error, 404)) return undefined
        throw error
      }
    }, 'getRangeBytes')
  }

  async getFileBytesWithContentType(
    bucket: string,
    key: string,
  ): Promise<
    { bytes: Buffer; contentType?: string; etag?: string } | undefined
  > {
    return this.executeAwsOperation(async () => {
      try {
        const response = await this.s3Client.send(
          new GetObjectCommand({
            Bucket: bucket,
            Key: key,
          }),
        )
        const bytes = await response.Body?.transformToByteArray()
        return bytes
          ? {
              bytes: Buffer.from(bytes),
              contentType: response.ContentType,
              etag: response.ETag,
            }
          : undefined
      } catch (error) {
        if (error instanceof NoSuchKey) return undefined
        if (isHttpStatusError(error, 404)) return undefined
        throw error
      }
    }, 'getFileBytesWithContentType')
  }

  async deleteObject(bucket: string, key: string): Promise<void> {
    return this.executeAwsOperation(async () => {
      try {
        const { DeleteObjectCommand } = await import('@aws-sdk/client-s3')
        await this.s3Client.send(
          new DeleteObjectCommand({ Bucket: bucket, Key: key }),
        )
      } catch (error) {
        if (error instanceof NoSuchKey) return
        throw error
      }
    }, 'deleteObject')
  }

  // On a versioned bucket DeleteObject only stacks a delete marker on the
  // key, so removing the data means deleting every version and every marker.
  // Lists by each key as a prefix and keeps exact matches only, so a key never
  // reaches another key that merely starts with it.
  async deleteAllObjectVersions(
    bucket: string,
    keys: string[],
  ): Promise<number> {
    return this.executeAwsOperation(async () => {
      let deleted = 0
      let batch: ObjectIdentifier[] = []
      const flush = async () => {
        if (batch.length === 0) return
        const { Errors } = await this.s3Client.send(
          new DeleteObjectsCommand({
            Bucket: bucket,
            Delete: { Objects: batch, Quiet: true },
          }),
        )
        if (Errors && Errors.length > 0) {
          throw new BadGatewayException(
            `S3 refused to delete ${Errors.length} object versions ` +
              `(${Errors[0]?.Code ?? 'unknown'})`,
          )
        }
        deleted += batch.length
        batch = []
      }

      for (const key of keys) {
        let keyMarker: string | undefined
        let versionIdMarker: string | undefined
        do {
          const page = await this.s3Client.send(
            new ListObjectVersionsCommand({
              Bucket: bucket,
              Prefix: key,
              KeyMarker: keyMarker,
              VersionIdMarker: versionIdMarker,
            }),
          )
          const entries = [
            ...(page.Versions ?? []),
            ...(page.DeleteMarkers ?? []),
          ]
          for (const entry of entries) {
            if (entry.Key !== key) continue
            batch.push({ Key: key, VersionId: entry.VersionId })
            if (batch.length === DELETE_OBJECTS_MAX_KEYS) await flush()
          }
          keyMarker = page.IsTruncated ? page.NextKeyMarker : undefined
          versionIdMarker = page.IsTruncated
            ? page.NextVersionIdMarker
            : undefined
        } while (keyMarker)
      }
      await flush()
      return deleted
    }, 'deleteAllObjectVersions')
  }

  async objectExists(bucket: string, key: string): Promise<boolean> {
    return this.executeAwsOperation(async () => {
      try {
        const { HeadObjectCommand } = await import('@aws-sdk/client-s3')
        await this.s3Client.send(
          new HeadObjectCommand({ Bucket: bucket, Key: key }),
        )
        return true
      } catch (error: unknown) {
        if (error instanceof NoSuchKey) return false
        // S3 HEAD on a missing key surfaces as either NoSuchKey or a plain
        // 404 NotFound depending on permissions; treat both as "missing".
        if (isHttpStatusError(error, 404)) return false
        throw error
      }
    }, 'objectExists')
  }

  /**
   * HEAD an object. Returns the object's metadata when present, null when
   * absent. Useful for validating both existence AND properties (like size)
   * in a single round-trip — callers that only need a boolean should use
   * `objectExists` instead.
   */
  async headObject(
    bucket: string,
    key: string,
  ): Promise<{ contentLength: number | null; etag?: string | null } | null> {
    return this.executeAwsOperation(async () => {
      try {
        const { HeadObjectCommand } = await import('@aws-sdk/client-s3')
        const response = await this.s3Client.send(
          new HeadObjectCommand({ Bucket: bucket, Key: key }),
        )
        return {
          contentLength: response.ContentLength ?? null,
          etag: response.ETag ?? null,
        }
      } catch (error: unknown) {
        if (error instanceof NoSuchKey) return null
        if (isHttpStatusError(error, 404)) return null
        throw error
      }
    }, 'headObject')
  }

  getFileUrl(
    bucket: string,
    key: string,
    options?: { baseUrl?: string },
  ): string {
    return this.buildUrl(bucket, key, options?.baseUrl)
  }

  async listKeys(bucket: string, prefix: string): Promise<string[]> {
    return this.executeAwsOperation(async () => {
      const keys: string[] = []
      let continuationToken: string | undefined

      do {
        const response = await this.s3Client.send(
          new ListObjectsV2Command({
            Bucket: bucket,
            Prefix: prefix,
            ContinuationToken: continuationToken,
          }),
        )

        for (const obj of response.Contents ?? []) {
          if (obj.Key) keys.push(obj.Key)
        }

        continuationToken = response.NextContinuationToken
      } while (continuationToken)

      return keys
    }, 'listKeys')
  }
}
