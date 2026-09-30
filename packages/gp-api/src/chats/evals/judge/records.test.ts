import { mkdtemp, readFile, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { CHAT_PAIR } from './fixtures/records'
import type { RunRecord } from './record'
import {
  ArmManifestSchema,
  RecordStoreError,
  createLocalRecordStore,
  createS3RecordStore,
  manifestKey,
  recordKey,
  type ArmManifest,
  type S3RecordPort,
} from './records'

// The local store is what tests use. Nothing here builds an S3 client: the
// S3 store is exercised through its port, which is three functions.

const [BASE, CANDIDATE] = CHAT_PAIR

const root = async (): Promise<string> =>
  mkdtemp(path.join(tmpdir(), 'judge-records-'))

const manifest = (over: Partial<ArmManifest> = {}): ArmManifest => ({
  schemaVersion: 1,
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
    expect(recordKey('swp_1', 'candidate', 'my-case', 2)).toBe(
      '_judge/swp_1/records/candidate/my-case-2.json',
    )
  })

  // A prefix check is not enough: `_judge/../x` starts with `_judge/`. Every
  // segment is pinned instead, so traversal is unrepresentable.
  it.each([
    ['sweepId', () => recordKey('../elsewhere', 'base', 'c', 1)],
    ['caseId', () => recordKey('swp', 'base', '../../c', 1)],
    ['empty sweepId', () => recordKey('', 'base', 'c', 1)],
    ['attempt zero', () => recordKey('swp', 'base', 'c', 0)],
    ['fractional attempt', () => recordKey('swp', 'base', 'c', 1.5)],
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
        CANDIDATE.caseId,
        CANDIDATE.attempt,
      ),
    )
    const onDisk = await readFile(path.join(dir, key), 'utf8')
    expect(JSON.parse(onDisk)).toEqual(CANDIDATE)
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
    const key = recordKey(BASE.sweepId, 'base', 'truncated', 1)
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
    await expect(store.getManifest(BASE.sweepId, 'base')).rejects.not.toThrow(
      /never reported a capture/,
    )
  })

  it('names the file when a stored record is corrupt', async () => {
    const dir = await root()
    const store = createLocalRecordStore(dir)
    const key = recordKey(BASE.sweepId, 'base', 'hand-written', 1)
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
        if (body === undefined) throw new Error(`no such key ${key}`)
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
      recordKey(BASE.sweepId, 'base', BASE.caseId, BASE.attempt),
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

  it('refuses to report a manifest that is not there', async () => {
    const store = createS3RecordStore(fakePort(), 'bucket')
    await expect(store.getManifest('swp_absent', 'base')).rejects.toThrow(
      /never reported a capture/,
    )
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
