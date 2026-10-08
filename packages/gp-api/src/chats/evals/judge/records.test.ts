import { mkdtemp, readFile, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { ListObjectsV2Command, S3Client } from '@aws-sdk/client-s3'
import { CHAT_PAIR } from './fixtures/records'
import type { RunRecord } from './record'
import {
  ArmManifestSchema,
  RecordNotFoundError,
  RecordStoreError,
  createLocalRecordStore,
  createS3RecordStore,
  MANIFEST_SCHEMA_VERSION,
  manifestKey,
  recordKey,
  rulingsKey,
  s3PortFromClient,
  type AgentRulings,
  type ArmManifest,
  type S3RecordPort,
} from './records'

// The local store is what tests use, and the S3 STORE is exercised through
// its port, which is three functions. The one place an S3Client appears is
// the adapter's own test at the bottom, which stubs `send` — the adapter is
// where pagination lives, so nothing else can check it, and a truncated
// listing silently judged as the whole sweep is the failure it exists to
// prevent.

const [BASE, CANDIDATE] = CHAT_PAIR

const RULINGS: AgentRulings = {
  sweepId: BASE.sweepId,
  agentId: BASE.agentId,
  rubricVersion: 'uj-rubric-test',
  judgments: [
    {
      kind: 'ungraded',
      key: { caseId: BASE.caseId, attempt: 1, order: 'primary' },
      reason: 'no judge seats configured',
    },
  ],
}

const root = async (): Promise<string> =>
  mkdtemp(path.join(tmpdir(), 'judge-records-'))

// `expect(promise).rejects.not.toThrow(/x/)` passes vacuously — it let a
// genuinely wrong message through here — so a "must not say X" assertion
// captures the error and reads its message instead.
const rejectionOf = async (run: Promise<unknown>): Promise<Error> => {
  const caught = await run.then(() => undefined).catch((err: Error) => err)
  if (caught === undefined) throw new Error('expected a rejection')
  return caught
}

const manifest = (over: Partial<ArmManifest> = {}): ArmManifest => ({
  schemaVersion: MANIFEST_SCHEMA_VERSION,
  spent: true,
  sweepId: BASE.sweepId,
  arm: 'base',
  ref: 'universal-judge',
  commit: 'a'.repeat(40),
  startedAt: '2026-09-29T10:00:00.000Z',
  endedAt: '2026-09-29T10:20:00.000Z',
  agents: [
    {
      agentId: BASE.agentId,
      caseList: 'chief_of_staff.json',
      placeholderCases: true,
      cases: 1,
      attempts: 1,
      recordsWritten: 1,
    },
  ],
  skipped: [],
  ...over,
})

describe('recordKey', () => {
  it('is the layout the design specifies', () => {
    expect(
      recordKey('swp_1', 'candidate', 'chief_of_staff', 'my-case', 2),
    ).toBe('_judge/swp_1/records/candidate/chief_of_staff/my-case-2.json')
  })

  // Inside `_judge/`, which is the prefix the broker's ticket allowlists. An
  // extra segment that pushed the key out of it would be refused at the
  // bucket rather than here.
  it('stays under the judge prefix', () => {
    expect(recordKey('swp_1', 'base', 'chief_of_staff', 'my-case', 1)).toMatch(
      /^_judge\//,
    )
  })

  // A prefix check is not enough: `_judge/../x` starts with `_judge/`. Every
  // segment is pinned instead, so traversal is unrepresentable.
  it.each([
    ['sweepId', () => recordKey('../elsewhere', 'base', 'a', 'c', 1)],
    ['agentId', () => recordKey('swp', 'base', '../../a', 'c', 1)],
    ['empty agentId', () => recordKey('swp', 'base', '', 'c', 1)],
    ['caseId', () => recordKey('swp', 'base', 'a', '../../c', 1)],
    ['empty sweepId', () => recordKey('', 'base', 'a', 'c', 1)],
    ['attempt zero', () => recordKey('swp', 'base', 'a', 'c', 0)],
    ['fractional attempt', () => recordKey('swp', 'base', 'a', 'c', 1.5)],
  ])('refuses a bad %s', (_name, build) => {
    expect(build).toThrow(RecordStoreError)
  })

  // Beside the records, not among them: `_manifest` is a legal caseId, so a
  // manifest sharing their directory would have to be told from a record by
  // its filename.
  it('keeps the manifest out of the records directory', () => {
    expect(manifestKey('swp_1', 'base')).toBe(
      '_judge/swp_1/manifests/base.json',
    )
    expect(manifestKey('swp_1', 'base')).not.toContain('/records/')
  })
})

describe('the local store', () => {
  it('round-trips a record through the filesystem', async () => {
    const store = createLocalRecordStore(await root())
    await store.putRecord(BASE)
    const [read] = await store.listRecords(BASE.sweepId, 'base')
    expect(read).toEqual(BASE)
  })

  it('writes each record at the key the layout names', async () => {
    const dir = await root()
    const store = createLocalRecordStore(dir)
    const key = await store.putRecord(CANDIDATE)
    expect(key).toBe(
      recordKey(
        CANDIDATE.sweepId,
        'candidate',
        CANDIDATE.agentId,
        CANDIDATE.caseId,
        CANDIDATE.attempt,
      ),
    )
    const onDisk = await readFile(path.join(dir, key), 'utf8')
    expect(JSON.parse(onDisk)).toEqual(CANDIDATE)
  })

  // A caseId is unique within ONE agent's case list and nowhere else:
  // `cases.ts` dedupes inside a list, and an arm manifest names several
  // agents. Two agents sharing a caseId used to write the same key, the
  // second replacing the first — and both records parse, so the sweep would
  // report one agent's answers as two agents'. Written through the store
  // rather than by comparing keys, because a key change alone could look
  // right while the listing found nothing.
  it('keeps two agents sharing one caseId apart', async () => {
    const store = createLocalRecordStore(await root())
    const first = await store.putRecord({
      ...BASE,
      agentId: 'chief_of_staff',
      caseId: 'shared',
      runId: 'run_shared_cos',
    })
    const second = await store.putRecord({
      ...BASE,
      agentId: 'priority_flow',
      caseId: 'shared',
      runId: 'run_shared_flow',
    })
    expect(second).not.toBe(first)

    const read = await store.listRecords(BASE.sweepId, 'base')
    expect(read.map((r) => r.agentId)).toEqual([
      'chief_of_staff',
      'priority_flow',
    ])
    expect(read.map((r) => r.runId)).toEqual([
      'run_shared_cos',
      'run_shared_flow',
    ])
  })

  it('keeps the two arms apart', async () => {
    const store = createLocalRecordStore(await root())
    await store.putRecord(BASE)
    await store.putRecord(CANDIDATE)
    const base = await store.listRecords(BASE.sweepId, 'base')
    const candidate = await store.listRecords(BASE.sweepId, 'candidate')
    expect(base.map((r) => r.arm)).toEqual(['base'])
    expect(candidate.map((r) => r.arm)).toEqual(['candidate'])
  })

  it('returns nothing for an arm that wrote nothing', async () => {
    const store = createLocalRecordStore(await root())
    expect(await store.listRecords('swp_absent', 'base')).toEqual([])
  })

  // The manifest is the check that separates "this arm ran nothing" from
  // "this arm never ran". A sweep must not be judged on one arm, and a vitest
  // suite whose tests all self-skipped passes while capturing nothing.
  it('refuses to report a manifest an arm never wrote', async () => {
    const store = createLocalRecordStore(await root())
    await expect(store.getManifest('swp_absent', 'base')).rejects.toThrow(
      /never reported a capture/,
    )
  })

  it('round-trips a manifest', async () => {
    const store = createLocalRecordStore(await root())
    const written = manifest()
    await store.putManifest(written)
    expect(await store.getManifest(written.sweepId, 'base')).toEqual(written)
  })

  // A store that accepts a record it cannot read back loses a paid-for run.
  it('refuses a manifest naming neither an agent nor a skip', async () => {
    const store = createLocalRecordStore(await root())
    await expect(
      store.putManifest(manifest({ agents: [], skipped: [] })),
    ).rejects.toThrow(/names neither an agent nor a skip/)
  })

  it('refuses a record the schema rejects', async () => {
    const store = createLocalRecordStore(await root())
    const bad: RunRecord = {
      ...BASE,
      telemetry: {
        ...BASE.telemetry,
        toolErrors: BASE.telemetry.toolCalls + 5,
      },
    }
    await expect(store.putRecord(bad)).rejects.toThrow(
      /toolErrors cannot exceed toolCalls/,
    )
  })

  // A killed capture leaves a truncated file, and this is the case the
  // schema-invalid test below cannot reach: '{"schemaVersion":1}' is valid
  // JSON. Before the fix this threw `SyntaxError: Unexpected end of JSON
  // input` naming nothing.
  it('names the file when a stored record is not even JSON', async () => {
    const dir = await root()
    const store = createLocalRecordStore(dir)
    const key = recordKey(BASE.sweepId, 'base', BASE.agentId, 'truncated', 1)
    await mkdir(path.dirname(path.join(dir, key)), { recursive: true })
    await writeFile(path.join(dir, key), '{"schemaVersion": 1, "swee', 'utf8')
    await expect(store.listRecords(BASE.sweepId, 'base')).rejects.toThrow(
      /truncated-1\.json: not valid JSON/,
    )
  })

  // Corrupt is not absent. "It never reported a capture" sends the reader to
  // look for a suite that self-skipped, which is the wrong hunt for a
  // half-written file.
  it('reports a corrupt manifest as corrupt, not as missing', async () => {
    const dir = await root()
    const store = createLocalRecordStore(dir)
    const key = manifestKey(BASE.sweepId, 'base')
    await mkdir(path.dirname(path.join(dir, key)), { recursive: true })
    await writeFile(path.join(dir, key), '{"schemaVersion": 1, "swee', 'utf8')
    await expect(store.getManifest(BASE.sweepId, 'base')).rejects.toThrow(
      /not valid JSON/,
    )
    expect(
      (await rejectionOf(store.getManifest(BASE.sweepId, 'base'))).message,
    ).not.toMatch(/never reported a capture/)
  })

  it('names the file when a stored record is corrupt', async () => {
    const dir = await root()
    const store = createLocalRecordStore(dir)
    const key = recordKey(BASE.sweepId, 'base', BASE.agentId, 'hand-written', 1)
    await mkdir(path.dirname(path.join(dir, key)), { recursive: true })
    await writeFile(path.join(dir, key), '{"schemaVersion":1}', 'utf8')
    await expect(store.listRecords(BASE.sweepId, 'base')).rejects.toThrow(
      /hand-written-1\.json: not a valid run record/,
    )
  })

  // Two runs over one directory must produce records in one order, because
  // the X/Y assignment is seeded and reproducible only if they do.
  it('returns records in a stable order', async () => {
    const store = createLocalRecordStore(await root())
    const ids = ['zulu', 'alpha', 'mike']
    for (const caseId of ids) {
      await store.putRecord({
        ...BASE,
        caseId,
        runId: `${BASE.runId}:${caseId}`,
      })
    }
    const first = await store.listRecords(BASE.sweepId, 'base')
    const second = await store.listRecords(BASE.sweepId, 'base')
    expect(first.map((r) => r.caseId)).toEqual(['alpha', 'mike', 'zulu'])
    expect(second.map((r) => r.caseId)).toEqual(first.map((r) => r.caseId))
  })
})

describe('the S3 store', () => {
  const fakePort = (): S3RecordPort & { objects: Map<string, string> } => {
    const objects = new Map<string, string>()
    return {
      objects,
      putObject: async (key, body) => {
        objects.set(key, body)
      },
      getObject: async (key) => {
        const body = objects.get(key)
        if (body === undefined) {
          throw new RecordNotFoundError(`no such key ${key}`)
        }
        return body
      },
      listKeys: async (prefix) =>
        [...objects.keys()].filter((key) => key.startsWith(prefix)),
    }
  }

  it('writes at the same keys the local store uses', async () => {
    const port = fakePort()
    const store = createS3RecordStore(port, 'gp-agent-artifacts-dev')
    await store.putRecord(BASE)
    await store.putManifest(manifest())
    expect([...port.objects.keys()].sort()).toEqual([
      manifestKey(BASE.sweepId, 'base'),
      recordKey(BASE.sweepId, 'base', BASE.agentId, BASE.caseId, BASE.attempt),
    ])
  })

  it('round-trips through the port', async () => {
    const store = createS3RecordStore(fakePort(), 'bucket')
    await store.putRecord(BASE)
    expect(await store.listRecords(BASE.sweepId, 'base')).toEqual([BASE])
  })

  // The candidate arm's records must not be read as the base arm's, and a
  // prefix that forgot its trailing slash would match neither more nor less
  // than that — `.../base` is not a prefix of `.../candidate/...`, but a
  // sweep id that was a prefix of another would be.
  it('does not pick up another sweep whose id shares a prefix', async () => {
    const port = fakePort()
    const store = createS3RecordStore(port, 'bucket')
    await store.putRecord({ ...BASE, sweepId: 'swp_1' })
    await store.putRecord({ ...BASE, sweepId: 'swp_12' })
    expect(await store.listRecords('swp_1', 'base')).toHaveLength(1)
  })

  // The same collision as the local store's, and it has to be checked here
  // too: the listing prefix is built separately from the write key, so a fix
  // that only changed the key would list nothing and the judging step would
  // refuse the arm as one that never reported.
  it('keeps two agents sharing one caseId apart', async () => {
    const port = fakePort()
    const store = createS3RecordStore(port, 'bucket')
    const first = await store.putRecord({
      ...BASE,
      agentId: 'chief_of_staff',
      caseId: 'shared',
      runId: 'run_shared_cos',
    })
    const second = await store.putRecord({
      ...BASE,
      agentId: 'priority_flow',
      caseId: 'shared',
      runId: 'run_shared_flow',
    })
    expect(second).not.toBe(first)
    expect(port.objects.size).toBe(2)

    const read = await store.listRecords(BASE.sweepId, 'base')
    expect(read.map((r) => r.runId)).toEqual([
      'run_shared_cos',
      'run_shared_flow',
    ])
  })

  it('refuses to report a manifest that is not there', async () => {
    const store = createS3RecordStore(fakePort(), 'bucket')
    await expect(store.getManifest('swp_absent', 'base')).rejects.toThrow(
      /never reported a capture/,
    )
  })

  // Absent is the only read failure that means the arm never reported.
  // Anything else announced as a missing manifest sends the reader looking
  // for a suite that self-skipped when the answer is an S3 problem.
  it.each<[string, Error]>([
    ['a denied read', new Error('AccessDenied: the judge role cannot read')],
    ['a dropped connection', new Error('socket hang up')],
    ['an object with no body', new RecordStoreError('returned no body')],
  ])('surfaces %s as itself', async (_name, failure) => {
    const store = createS3RecordStore(
      { ...fakePort(), getObject: () => Promise.reject(failure) },
      'bucket',
    )
    await expect(store.getManifest(BASE.sweepId, 'base')).rejects.toBe(failure)
  })
})

describe('ArmManifestSchema', () => {
  // A manifest naming only a skip is valid: an arm that skipped every agent
  // did report, and the reason is what the report prints.
  it('accepts an arm that only skipped', () => {
    const parsed = ArmManifestSchema.safeParse(
      manifest({
        agents: [],
        skipped: [{ agentId: 'meeting_briefing', reason: 'no runner yet' }],
      }),
    )
    expect(parsed.success).toBe(true)
  })

  it('rejects a timestamp that is not a timestamp', () => {
    const parsed = ArmManifestSchema.safeParse(
      manifest({ startedAt: 'not a date' }),
    )
    expect(parsed.success).toBe(false)
  })
})

// The base arm writes its manifest with the BASE REF's copy of records.ts and
// the judging step parses it with the candidate's, so a required field added
// on the candidate side arrives as a missing field rather than as a version
// difference. Both arms are billed before anyone reads the message, so it has
// to name the real cause.
describe('a manifest from another checkout', () => {
  const v1 = async (): Promise<string> => {
    const dir = await root()
    const key = manifestKey(BASE.sweepId, 'base')
    const file = path.join(dir, key)
    await mkdir(path.dirname(file), { recursive: true })
    // What a base ref that predates `spent` wrote: schemaVersion 1, and no
    // `spent` at all.
    const { spent, ...rest } = manifest()
    expect(spent).toBe(true)
    await writeFile(
      file,
      JSON.stringify({ ...rest, schemaVersion: 1 }, null, 2),
      'utf8',
    )
    return dir
  }

  // Older still: a base ref from before `schemaVersion` existed writes no
  // version field at all. That is the commonest skew rather than an exotic
  // one, and it used to fall through to the generic "not a valid arm
  // manifest" error, which reads as a truncated file and buries the sentence
  // that says what to do about it.
  const unversioned = async (): Promise<string> => {
    const dir = await root()
    const key = manifestKey(BASE.sweepId, 'base')
    const file = path.join(dir, key)
    await mkdir(path.dirname(file), { recursive: true })
    const { schemaVersion, spent, ...rest } = manifest()
    expect(schemaVersion).toBe(MANIFEST_SCHEMA_VERSION)
    expect(spent).toBe(true)
    await writeFile(file, JSON.stringify(rest, null, 2), 'utf8')
    return dir
  }

  it('names the skew when there is no version field at all', async () => {
    const store = createLocalRecordStore(await unversioned())
    await expect(store.getManifest(BASE.sweepId, 'base')).rejects.toThrow(
      /carries no schemaVersion at all/,
    )
  })

  it('does not read an unversioned manifest as corruption', async () => {
    const store = createLocalRecordStore(await unversioned())
    expect(
      (await rejectionOf(store.getManifest(BASE.sweepId, 'base'))).message,
    ).not.toMatch(/not a valid arm manifest/)
  })

  it('names the version skew rather than the missing field', async () => {
    const store = createLocalRecordStore(await v1())
    await expect(store.getManifest(BASE.sweepId, 'base')).rejects.toThrow(
      /schemaVersion 1 and this checkout reads 2/,
    )
  })

  // The failure it must NOT be read as: `spent: Invalid input` sends the
  // reader hunting for a truncated file on a sweep that wrote a perfectly
  // good manifest.
  it('does not report it as a corrupt manifest', async () => {
    const store = createLocalRecordStore(await v1())
    expect(
      (await rejectionOf(store.getManifest(BASE.sweepId, 'base'))).message,
    ).not.toMatch(/not a valid arm manifest/)
  })
})

// The adapter, not the store. `listKeys` is the one function in this file
// with a loop in it, and the comment above it says what a first-page-only
// read would do: drop cases from the delta with nothing to show it happened.
// Reaches no AWS — `send` never runs.
describe('s3PortFromClient.listKeys', () => {
  it('follows a truncated listing to the last page', async () => {
    const pages = [
      {
        Contents: [{ Key: 'a.json' }, { Key: 'b.json' }],
        IsTruncated: true,
        NextContinuationToken: 't1',
      },
      {
        Contents: [{ Key: 'c.json' }],
        IsTruncated: true,
        NextContinuationToken: 't2',
      },
      { Contents: [{ Key: 'd.json' }], IsTruncated: false },
    ]
    const tokens: (string | undefined)[] = []
    let call = 0
    const client = new S3Client({ region: 'us-east-1' })
    Object.assign(client, {
      send: async (command: ListObjectsV2Command) => {
        tokens.push(command.input.ContinuationToken)
        return pages[call++]
      },
    })

    const keys = await s3PortFromClient(client, 'bucket').listKeys('_judge/')

    expect(keys).toEqual(['a.json', 'b.json', 'c.json', 'd.json'])
    // Each page asked for the one after it, and the unpaginated first call
    // carried no token.
    expect(tokens).toEqual([undefined, 't1', 't2'])
  })

  // `IsTruncated: true` with no token is the only shape that could loop
  // forever, and the adapter treats it as the end rather than re-reading the
  // same page.
  it('stops when a truncated page hands back no token', async () => {
    const client = new S3Client({ region: 'us-east-1' })
    Object.assign(client, {
      send: async () => ({ Contents: [{ Key: 'a.json' }], IsTruncated: true }),
    })
    expect(
      await s3PortFromClient(client, 'bucket').listKeys('_judge/'),
    ).toEqual(['a.json'])
  })
})

// A CROSS-CHECKOUT CONTRACT. The base arm writes its manifest with the BASE
// REF's copy of ArmAgentSchema and the judging step parses it with the
// candidate's. A ref that still carries `seededTranscriptCases` writes it on
// an agent entry, and the judging step has to read that manifest rather than
// refuse it as corrupt.
describe('a manifest from a ref that still marks seeded transcripts', () => {
  it('parses and drops the field', () => {
    const olderAgent = {
      agentId: BASE.agentId,
      caseList: 'chief_of_staff.json',
      placeholderCases: false,
      seededTranscriptCases: ['mid-conversation'],
      cases: 2,
      attempts: 1,
      recordsWritten: 2,
    }
    const parsed = ArmManifestSchema.parse(manifest({ agents: [olderAgent] }))
    expect(parsed.agents[0]).not.toHaveProperty('seededTranscriptCases')
    expect(parsed.schemaVersion).toBe(2)
  })
})

// Rulings sit beside the records, under a sibling of `records/`, so the
// listing the judge reads its pairs from cannot pick one up as a run.
describe('per-case rulings', () => {
  it('writes them locally and resolves to the file a reader opens', async () => {
    const dir = await root()
    const store = createLocalRecordStore(dir)
    const location = await store.putRulings(RULINGS)
    expect(location).toBe(
      path.join(dir, rulingsKey(RULINGS.sweepId, RULINGS.agentId)),
    )
    expect(JSON.parse(await readFile(location, 'utf8'))).toEqual(RULINGS)
  })

  it('is never listed as a record', async () => {
    const store = createLocalRecordStore(await root())
    await store.putRecord(BASE)
    await store.putRulings(RULINGS)
    expect(await store.listRecords(BASE.sweepId, 'base')).toEqual([BASE])
  })

  it('writes them to S3 and resolves to the object URL', async () => {
    const objects = new Map<string, string>()
    const store = createS3RecordStore(
      {
        putObject: async (key, body) => {
          objects.set(key, body)
        },
        getObject: async () => '',
        listKeys: async () => [],
      },
      'bucket',
    )
    const key = rulingsKey(RULINGS.sweepId, RULINGS.agentId)
    expect(await store.putRulings(RULINGS)).toBe(`s3://bucket/${key}`)
    expect(JSON.parse(objects.get(key) ?? '')).toEqual(RULINGS)
  })

  it('refuses an agent id that is not a key segment', () => {
    expect(() => rulingsKey(BASE.sweepId, '../manifests')).toThrow(
      RecordStoreError,
    )
  })
})
