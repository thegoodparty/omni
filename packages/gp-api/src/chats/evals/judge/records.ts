import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import {
  GetObjectCommand,
  ListObjectsV2Command,
  NoSuchKey,
  PutObjectCommand,
  S3Client,
  type GetObjectCommandOutput,
} from '@aws-sdk/client-s3'
import { MimeTypes } from 'http-constants-ts'
import { z } from 'zod'
import { describeIssues } from './cases'
import {
  ArmSchema,
  JsonValueSchema,
  RunRecordSchema,
  type Arm,
  type JsonValue,
  type RunRecord,
} from './record'

// Where a sweep's records live, behind an interface narrow enough that the
// judging entry cannot tell S3 from a directory.
//
// Two implementations, and the split is not a convenience. The arms run as
// separate processes in separate checkouts, so the only thing they share is
// this store: the candidate process cannot hand the base process's records to
// the judge in memory.
//
// Both CI and local use the directory today. S3 is what the design wants,
// because records that outlive the run let a rubric change re-grade them at
// zero agent cost — but it needs an IAM grant and an `id-token: write` that
// judge.yml deliberately does not take yet, and that file explains why.
//
// TESTS USE THE LOCAL ONE. Nothing in this file constructs an S3 client on its
// own; `createS3RecordStore` takes the client, so a test that wanted to reach
// S3 would have to build one and hand it over on purpose.

// Every segment of a key is held to this. A prefix check is not enough — the
// background runner's design makes the same point about
// `_judge/../compliance_setup/manifest.json`, which starts with `_judge/` and
// addresses something else entirely. Pinning each segment makes traversal,
// absolute paths and empty segments unrepresentable rather than individually
// forbidden.
const SEGMENT = /^[A-Za-z0-9_-]+$/

export class RecordStoreError extends Error {}

// S3's ENOENT, and the only failure a store may read as "nothing was written
// here". The port raises it because recognising an absent object is the
// adapter's job: the store is deliberately free of the SDK's types.
export class RecordNotFoundError extends RecordStoreError {}

// ENOENT, and nothing else. Every other errno is a real failure that must not
// be read as "there is nothing here".
//
// A type guard rather than a cast: the value comes from a rejected fs
// promise, so `code` has to be narrowed rather than asserted.
// Narrowed with `in` rather than asserted: no-unsafe-type-assertion rejects
// the usual `(err as { code?: string })` shape, and `in` gives TypeScript the
// property without a cast.
const isMissing = (err: Error): boolean =>
  'code' in err && err.code === 'ENOENT'

const segment = (name: string, value: string): string => {
  if (!SEGMENT.test(value)) {
    throw new RecordStoreError(
      `${name} "${value}" is not a usable key segment: only letters, ` +
        'digits, underscore and hyphen, and it may not be empty',
    )
  }
  return value
}

export const JUDGE_PREFIX = '_judge'

// Everything above the agent, and the only place either store builds it.
// Shared rather than written twice: a listing prefix that drifts from the
// write key lists nothing, and the judging entry reads an empty listing as an
// arm that never reported — a paid capture refused for a typo.
const armRecordsPrefix = (sweepId: string, arm: Arm): string =>
  [
    JUDGE_PREFIX,
    segment('sweepId', sweepId),
    'records',
    segment('arm', arm),
  ].join('/')

// The agent is a segment of its own because a caseId is unique within ONE
// agent's case list and nowhere else: `cases.ts` dedupes inside a list, and
// an arm manifest names several agents. Two agents sharing a caseId would
// otherwise write the same key, the second replacing the first — and both
// records parse, so nothing downstream could tell that one agent's answers
// are being reported as two agents'.
export const recordKey = (
  sweepId: string,
  arm: Arm,
  agentId: string,
  caseId: string,
  attempt: number,
): string => {
  if (!Number.isInteger(attempt) || attempt < 1) {
    throw new RecordStoreError(
      `attempt ${attempt} is not a positive integer, and it is half of the ` +
        'filename that keeps two attempts of one case apart',
    )
  }
  return [
    armRecordsPrefix(sweepId, arm),
    segment('agentId', agentId),
    `${segment('caseId', caseId)}-${attempt}.json`,
  ].join('/')
}

// Beside the records rather than among them. A manifest sharing their
// directory would have to be told apart from a record by its filename, and
// `_manifest` is a legal caseId.
export const manifestKey = (sweepId: string, arm: Arm): string =>
  [
    JUDGE_PREFIX,
    segment('sweepId', sweepId),
    'manifests',
    `${segment('arm', arm)}.json`,
  ].join('/')

// A skipped agent, named. The alternative is an agent that quietly produced no
// records, which reads downstream as a sweep that found nothing to say rather
// than one that never asked.
export const ArmSkipSchema = z.object({
  agentId: z.string().min(1),
  reason: z.string().min(1),
})
export type ArmSkip = z.infer<typeof ArmSkipSchema>

export const ArmAgentSchema = z.object({
  agentId: z.string().min(1),
  caseList: z.string().min(1),
  placeholderCases: z.boolean(),
  cases: z.number().int().nonnegative(),
  attempts: z.number().int().positive(),
  recordsWritten: z.number().int().nonnegative(),
})
export type ArmAgent = z.infer<typeof ArmAgentSchema>

// What one arm's capture did, and — the part the design turns on — WHEN.
//
// Arms cannot be interleaved in time: each is a separate process in a separate
// checkout, so all of base runs and then all of candidate. Rather than pretend
// otherwise, each arm stamps its own window and the report prints the gap
// between the two, flagging a comparison whose arms are far apart. That is the
// same treatment a cached background base arm already gets.
// A CROSS-CHECKOUT CONTRACT, which is why this number moves when a required
// field arrives. The base arm writes its manifest with the BASE REF's copy of
// this file and the judging step parses it with the candidate's, so the two
// are different builds of the same schema. `spent` became required in v2; a
// base ref that carries the sweep suite (which the workflow checks for) but
// predates `spent` writes a v1 manifest, and reading it against v2 reports
// `spent: Invalid input` — a corruption message for what is really version
// skew, sending the reader to look for a truncated file.
export const MANIFEST_SCHEMA_VERSION = 2

export const ArmManifestSchema = z
  .object({
    schemaVersion: z.literal(MANIFEST_SCHEMA_VERSION),
    sweepId: z.string().min(1),
    arm: ArmSchema,
    ref: z.string().min(1),
    commit: z.string().min(1),
    startedAt: z.string().datetime(),
    endedAt: z.string().datetime(),
    agents: z.array(ArmAgentSchema),
    skipped: z.array(ArmSkipSchema),
    // Whether THIS arm called a model, carried across the process boundary
    // because the arms and the judging step read their spend switch from two
    // different workflow steps and so can disagree. The judging entry refuses
    // a mismatch: a paid capture graded by a canned panel reports CAN'T SAY
    // on every case, and a paid panel grading canned replies reports a
    // confident verdict about two stub strings.
    spent: z.boolean(),
  })
  .refine((m) => m.agents.length > 0 || m.skipped.length > 0, {
    message:
      'an arm manifest that names neither an agent nor a skip describes ' +
      'a capture that did nothing, which must not be mistaken for one ' +
      'that found nothing to compare',
    path: ['agents'],
  })
export type ArmManifest = z.infer<typeof ArmManifestSchema>

export interface RecordStore {
  putRecord: (record: RunRecord) => Promise<string>
  putManifest: (manifest: ArmManifest) => Promise<string>
  listRecords: (sweepId: string, arm: Arm) => Promise<RunRecord[]>
  // Throws when the arm never reported. That is the check that stops a
  // sweep whose suite silently ran zero tests from being judged as though
  // both arms had answered.
  getManifest: (sweepId: string, arm: Arm) => Promise<ArmManifest>
}

// A killed capture leaves a truncated file, so the JSON parse is inside the
// naming: `SyntaxError: Unexpected end of JSON input` with no filename is the
// least useful thing this could say about the one failure it will actually
// see.
const readJson = (where: string, text: string): JsonValue => {
  try {
    return JsonValueSchema.parse(JSON.parse(text))
  } catch (err) {
    throw new RecordStoreError(
      `${where}: not valid JSON — ${
        err instanceof Error ? err.message : String(err)
      }`,
    )
  }
}

const parseRecord = (where: string, text: string): RunRecord => {
  const parsed = RunRecordSchema.safeParse(readJson(where, text))
  if (!parsed.success) {
    throw new RecordStoreError(
      `${where}: not a valid run record — ` +
        describeIssues(parsed.error.issues),
    )
  }
  return parsed.data
}

// Read on its own, before anything else is validated, so a manifest written
// by another checkout's build of this file gets its own sentence. `spent` has
// no `.default(false)` on purpose: defaulting it would claim a paid arm was
// canned and satisfy the judging step's spend-agreement check the wrong way
// round, which is worse than refusing.
// `schemaVersion` optional on PURPOSE. A manifest written before the field
// existed has none at all, and that is the commonest skew rather than an
// exotic one: the base arm runs from the base ref's checkout, so any base
// older than the field produces exactly this shape. Requiring it here would
// make `safeParse` fail and drop the absent case through to the generic
// "not a valid arm manifest" error, which reads as corruption and buries the
// one sentence that says what to do.
const ManifestVersionSchema = z.object({
  schemaVersion: z.number().optional(),
})

const SKEW_ADVICE =
  'The two arms are two checkouts, so the one that wrote it is on a ' +
  'different build of the judge — nothing is corrupt; the base ref and the ' +
  'candidate disagree about the manifest. Bring the base ref up to a commit ' +
  'that carries this version.'

const parseManifest = (where: string, text: string): ArmManifest => {
  const json = readJson(where, text)
  const version = ManifestVersionSchema.safeParse(json)
  if (version.success && version.data.schemaVersion === undefined) {
    throw new RecordStoreError(
      `${where}: this manifest carries no schemaVersion at all, so it was ` +
        'written before the field existed, and this checkout reads ' +
        `${MANIFEST_SCHEMA_VERSION}. ${SKEW_ADVICE}`,
    )
  }
  if (
    version.success &&
    version.data.schemaVersion !== MANIFEST_SCHEMA_VERSION
  ) {
    throw new RecordStoreError(
      `${where}: this manifest is schemaVersion ` +
        `${version.data.schemaVersion} and this checkout reads ` +
        `${MANIFEST_SCHEMA_VERSION}. ${SKEW_ADVICE}`,
    )
  }
  const parsed = ArmManifestSchema.safeParse(json)
  if (!parsed.success) {
    throw new RecordStoreError(
      `${where}: not a valid arm manifest — ` +
        describeIssues(parsed.error.issues),
    )
  }
  return parsed.data
}

// Validated on the way in as well as on the way out. A store that accepts a
// record it cannot later read back is a store that loses a paid-for run, and
// both arms write through here.
const serializeRecord = (record: RunRecord): string =>
  `${JSON.stringify(RunRecordSchema.parse(record), null, 2)}\n`

const serializeManifest = (manifest: ArmManifest): string =>
  `${JSON.stringify(ArmManifestSchema.parse(manifest), null, 2)}\n`

// ---------------------------------------------------------------------------
// Local directory
// ---------------------------------------------------------------------------

export const createLocalRecordStore = (root: string): RecordStore => {
  const resolvedRoot = path.resolve(root)

  // Belt and braces over `segment()`. That function is what makes a key safe,
  // but it is called with values from a runner as well as from a case list,
  // and this store turns a key into a filesystem write. A key that ever did
  // escape would write outside the sweep's directory, so the resolved path is
  // checked as well as the segments it was built from.
  const fileFor = (key: string): string => {
    const file = path.resolve(resolvedRoot, key)
    if (!file.startsWith(resolvedRoot + path.sep)) {
      throw new RecordStoreError(
        `key "${key}" resolves outside ${resolvedRoot}`,
      )
    }
    return file
  }

  const write = async (key: string, body: string): Promise<string> => {
    const file = fileFor(key)
    await mkdir(path.dirname(file), { recursive: true })
    await writeFile(file, body, 'utf8')
    return key
  }

  return {
    // `async` is load-bearing: `serializeRecord` validates, and a method
    // that returns a promise must reject rather than throw out from under a
    // caller who only attached a `.catch`.
    putRecord: async (record) =>
      write(
        recordKey(
          record.sweepId,
          record.arm,
          record.agentId,
          record.caseId,
          record.attempt,
        ),
        serializeRecord(record),
      ),

    putManifest: async (manifest) =>
      write(
        manifestKey(manifest.sweepId, manifest.arm),
        serializeManifest(manifest),
      ),

    listRecords: async (sweepId, arm) => {
      const dir = fileFor(armRecordsPrefix(sweepId, arm))
      let names: string[]
      try {
        // Recursive because the records sit one level down, under the agent
        // that produced them. A flat read would find only the agent
        // directories, which the `.json` filter then drops — an arm with
        // records listing none.
        names = await readdir(dir, { recursive: true })
      } catch (err) {
        // ENOENT only. An arm with no directory has no records, and telling
        // "this arm never ran" from "this arm ran nothing" is the manifest's
        // job. Anything else — EACCES, EIO, EMFILE — is a real failure, and
        // reporting it as "no records" would have the judging entry announce
        // a gap in the sweep for a capture that really did run and really
        // did pay.
        if (!(err instanceof Error) || !isMissing(err)) throw err
        return []
      }
      // Sorted so two runs over one directory produce records in the same
      // order, which is what keeps a seeded slot assignment reproducible.
      const files = names.filter((n) => n.endsWith('.json')).sort()
      return Promise.all(
        files.map(async (name) =>
          parseRecord(
            path.join(dir, name),
            await readFile(path.join(dir, name), 'utf8'),
          ),
        ),
      )
    },

    getManifest: async (sweepId, arm) => {
      const file = fileFor(manifestKey(sweepId, arm))
      // The read is inside the try and the parse is outside it, so a manifest
      // that exists but is truncated is reported as corrupt rather than as
      // absent. "It never reported a capture" sends the reader to look for a
      // suite that self-skipped, which is the wrong hunt for a half-written
      // file.
      let text: string
      try {
        text = await readFile(file, 'utf8')
      } catch (err) {
        if (!(err instanceof Error) || !isMissing(err)) throw err
        throw new RecordStoreError(
          `the ${arm} arm of sweep ${sweepId} wrote no manifest ` +
            `(${file}), so it never reported a capture; a sweep is not ` +
            'judged on one arm',
        )
      }
      return parseManifest(file, text)
    },
  }
}

// ---------------------------------------------------------------------------
// S3
// ---------------------------------------------------------------------------

// The judge's use of S3 is three operations, so the port is three operations
// rather than a slice of the AWS SDK's client. That keeps the store free of
// the SDK's command types, puts pagination in the adapter where it belongs,
// and means a fake is three functions.
//
// NOTHING IN THIS FILE CONSTRUCTS ONE. `s3PortFromClient` takes the client, so
// reaching S3 from a test would mean building an S3Client and handing it over
// deliberately.
export interface S3RecordPort {
  putObject: (key: string, body: string) => Promise<void>
  // Rejects with RecordNotFoundError when the object is absent, which is how
  // a missing arm manifest is told from an empty one, and with whatever went
  // wrong for every other failure.
  getObject: (key: string) => Promise<string>
  listKeys: (prefix: string) => Promise<string[]>
}

export const createS3RecordStore = (
  port: S3RecordPort,
  bucket: string,
): RecordStore => {
  const write = async (key: string, body: string): Promise<string> => {
    await port.putObject(key, body)
    return key
  }

  return {
    putRecord: async (record) =>
      write(
        recordKey(
          record.sweepId,
          record.arm,
          record.agentId,
          record.caseId,
          record.attempt,
        ),
        serializeRecord(record),
      ),

    putManifest: async (manifest) =>
      write(
        manifestKey(manifest.sweepId, manifest.arm),
        serializeManifest(manifest),
      ),

    listRecords: async (sweepId, arm) => {
      // The trailing slash is what stops one arm from picking up another
      // whose name it prefixes, and S3's key space is flat — so the agent
      // level below costs this listing nothing.
      const prefix = `${armRecordsPrefix(sweepId, arm)}/`

      // Sorted for the same reason the local store sorts: a seeded slot
      // assignment is only reproducible if the records arrive in one order.
      const keys = (await port.listKeys(prefix))
        .filter((key) => key.endsWith('.json'))
        .sort()

      return Promise.all(
        keys.map(async (key) =>
          parseRecord(`s3://${bucket}/${key}`, await port.getObject(key)),
        ),
      )
    },

    getManifest: async (sweepId, arm) => {
      const key = manifestKey(sweepId, arm)
      let text: string
      try {
        text = await port.getObject(key)
      } catch (err) {
        // Absent only, the way the local store checks for ENOENT. A denied
        // read, a dropped connection or an object with no body is a real
        // failure, and calling it a manifest the arm never wrote sends the
        // reader hunting for a self-skipped vitest suite.
        if (!(err instanceof RecordNotFoundError)) throw err
        throw new RecordStoreError(
          `the ${arm} arm of sweep ${sweepId} wrote no manifest ` +
            `(s3://${bucket}/${key}), so it never reported a capture; a ` +
            'sweep is not judged on one arm',
        )
      }
      return parseManifest(`s3://${bucket}/${key}`, text)
    },
  }
}

// Paginated rather than taking the first page. A 20-case sweep at three
// attempts is 60 objects and one page today, and the default page is 1000 —
// but silently judging the first 1000 of a larger sweep would drop cases from
// the delta with nothing to show it happened.
export const s3PortFromClient = (
  client: S3Client,
  bucket: string,
): S3RecordPort => ({
  putObject: async (key, body) => {
    await client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: body,
        ContentType: MimeTypes.APPLICATION_JSON,
      }),
    )
  },

  getObject: async (key) => {
    let output: GetObjectCommandOutput
    try {
      output = await client.send(
        new GetObjectCommand({ Bucket: bucket, Key: key }),
      )
    } catch (err) {
      if (!(err instanceof NoSuchKey)) throw err
      throw new RecordNotFoundError(`s3://${bucket}/${key} is not there`)
    }
    if (output.Body === undefined) {
      throw new RecordStoreError(`s3://${bucket}/${key} returned no body`)
    }
    return output.Body.transformToString('utf8')
  },

  listKeys: async (prefix) => {
    const keys: string[] = []
    let token: string | undefined
    do {
      const page = await client.send(
        new ListObjectsV2Command({
          Bucket: bucket,
          Prefix: prefix,
          ...(token !== undefined && { ContinuationToken: token }),
        }),
      )
      for (const item of page.Contents ?? []) {
        if (item.Key !== undefined) keys.push(item.Key)
      }
      token = page.IsTruncated === true ? page.NextContinuationToken : undefined
    } while (token !== undefined)
    return keys
  },
})
