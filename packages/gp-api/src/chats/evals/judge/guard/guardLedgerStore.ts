import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import path from 'node:path'
import {
  GetObjectCommand,
  NoSuchKey,
  PutObjectCommand,
  S3Client,
  type GetObjectCommandOutput,
} from '@aws-sdk/client-s3'
import { MimeTypes } from 'http-constants-ts'
import { z } from 'zod'
import type { GuardLedgerPort } from './guardLedger'

// S3 adapter. Mirrors records.ts's `s3PortFromClient` in shape — nothing in
// this file constructs an S3Client on its own, so a test that wants real S3
// has to build one and hand it over on purpose.
export const s3GuardLedgerPort = (
  client: S3Client,
  bucket: string,
): GuardLedgerPort => ({
  getWithEtag: async (key) => {
    let output: GetObjectCommandOutput
    try {
      output = await client.send(
        new GetObjectCommand({ Bucket: bucket, Key: key }),
      )
    } catch (err) {
      if (err instanceof NoSuchKey) return undefined
      throw err
    }
    if (output.Body === undefined || output.ETag === undefined) {
      throw new Error(`s3://${bucket}/${key} returned no body or no ETag`)
    }
    return {
      text: await output.Body.transformToString('utf8'),
      etag: output.ETag,
    }
  },

  putIfMatch: async (key, text, ifMatch) => {
    try {
      const result = await client.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: key,
          Body: text,
          // JSON Lines has no registered MIME type of its own; the records
          // store's objects are all JSON, so this reuses that type rather
          // than inventing a new constant for one file extension.
          ContentType: MimeTypes.APPLICATION_JSON,
          ...(ifMatch === 'NONE'
            ? { IfNoneMatch: '*' }
            : { IfMatch: ifMatch }),
        }),
      )
      if (result.ETag === undefined) {
        throw new Error(`s3://${bucket}/${key} put returned no ETag`)
      }
      return { etag: result.ETag }
    } catch (err) {
      // A failed precondition (IfMatch/IfNoneMatch) comes back as an HTTP
      // 412 with no dedicated exception class in this SDK version, so the
      // status code is the only reliable signal that someone else won the
      // race the retry loop expects to lose sometimes.
      if (httpStatus(err) === 412) return 'conflict'
      throw err
    }
  },
})

// A zod parse rather than a cast: the SDK types its rejected errors as
// `unknown`, and this repo's lint forbids narrowing one with `as`.
const AwsErrorMetadataSchema = z.object({
  $metadata: z.object({ httpStatusCode: z.number() }),
})

const httpStatus = (err: unknown): number | undefined =>
  AwsErrorMetadataSchema.safeParse(err).data?.$metadata.httpStatusCode

// Local directory fallback, for tests and for a run whose AWS role was never
// assumed (same fallback records.ts documents for the record store). A
// single process writing to its own directory has no real race to resolve,
// so the ETag here is a content hash rather than anything S3-shaped — it
// only has to agree with itself across a read and a write a moment apart.
export const localGuardLedgerPort = (root: string): GuardLedgerPort => {
  const resolvedRoot = path.resolve(root)
  const fileFor = (key: string): string => {
    const file = path.resolve(resolvedRoot, key)
    if (!file.startsWith(resolvedRoot + path.sep)) {
      throw new Error(`key "${key}" resolves outside ${resolvedRoot}`)
    }
    return file
  }
  const hash = (text: string): string =>
    createHash('sha256').update(text).digest('hex')

  return {
    getWithEtag: async (key) => {
      const file = fileFor(key)
      try {
        const text = await readFile(file, 'utf8')
        return { text, etag: hash(text) }
      } catch (err) {
        if (err instanceof Error && 'code' in err && err.code === 'ENOENT') {
          return undefined
        }
        throw err
      }
    },

    putIfMatch: async (key, text, ifMatch) => {
      const file = fileFor(key)
      const current = await (async (): Promise<string | undefined> => {
        try {
          return await readFile(file, 'utf8')
        } catch (err) {
          if (err instanceof Error && 'code' in err && err.code === 'ENOENT') {
            return undefined
          }
          throw err
        }
      })()
      const currentEtag = current === undefined ? undefined : hash(current)
      const expected = ifMatch === 'NONE' ? undefined : ifMatch
      if (currentEtag !== expected) return 'conflict'
      await mkdir(path.dirname(file), { recursive: true })
      // Write-then-rename, so a reader never observes a partially written
      // file — the same reason the case scout's bucket helper and this
      // repo's other local stores avoid writing the destination path
      // directly.
      const tmp = `${file}.${process.pid}.${Date.now()}.tmp`
      await writeFile(tmp, text, 'utf8')
      await rename(tmp, file)
      return { etag: hash(text) }
    },
  }
}
