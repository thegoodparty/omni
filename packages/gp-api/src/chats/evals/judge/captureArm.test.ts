import { execFileSync } from 'node:child_process'
import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import type { AgentEntry } from './agents'
import {
  DEV_API_URL,
  armProblems,
  armRegistry,
  chatArmRefusal,
  chatArmUrl,
} from './captureArm'
import { CHAT_PAIR } from './fixtures/records'
import { ArmManifestSchema, type ArmManifest } from './records'

const COS: AgentEntry = {
  agentId: 'chief_of_staff',
  shape: 'chat',
  cases: 'chief_of_staff.json',
  status: 'pending',
}

const BACKGROUND: AgentEntry = {
  agentId: 'meeting_briefing',
  shape: 'background',
  cases: 'meeting_briefing.json',
  status: 'pending',
}

describe('chatArmUrl', () => {
  it('drives dev on the base arm unless told otherwise', () => {
    expect(chatArmUrl({ arm: 'base' }, {})).toBe(DEV_API_URL)
    expect(
      chatArmUrl(
        { arm: 'base' },
        { JUDGE_BASE_API_URL: 'http://localhost:3000/' },
      ),
    ).toBe('http://localhost:3000')
  })

  it('has no default deployment for the candidate', () => {
    expect(chatArmUrl({ arm: 'candidate' }, {})).toBeUndefined()
    expect(
      chatArmUrl({ arm: 'candidate' }, { JUDGE_CANDIDATE_API_URL: '' }),
    ).toBeUndefined()
    expect(
      chatArmUrl(
        { arm: 'candidate' },
        { JUDGE_CANDIDATE_API_URL: 'https://pr-12.preview.goodparty.org' },
      ),
    ).toBe('https://pr-12.preview.goodparty.org')
  })
})

describe('chatArmRefusal', () => {
  it('refuses chat on a dry run, which has no free path', () => {
    expect(chatArmRefusal(false, DEV_API_URL, 'sk')).toMatch(/JUDGE_SPEND/)
  })

  it('refuses chat with no deployment or no Clerk key', () => {
    expect(chatArmRefusal(true, undefined, 'sk')).toMatch(
      /JUDGE_CANDIDATE_API_URL/,
    )
    expect(chatArmRefusal(true, DEV_API_URL, undefined)).toMatch(
      /JUDGE_CLERK_SECRET_KEY/,
    )
  })

  it('lets a spending arm with a deployment and a key drive chat', () => {
    expect(chatArmRefusal(true, DEV_API_URL, 'sk')).toBeUndefined()
  })
})

describe('armRegistry', () => {
  it('blocks every chat agent with the refusal, and nothing else', () => {
    const [chat, background] = armRegistry([COS, BACKGROUND], 'no spend')
    expect(chat).toMatchObject({ status: 'blocked', blockedReason: 'no spend' })
    expect(background).toEqual(BACKGROUND)
  })

  it('leaves the registry alone when chat may run', () => {
    expect(armRegistry([COS, BACKGROUND], undefined)).toEqual([COS, BACKGROUND])
  })
})

describe('armProblems', () => {
  const [record] = CHAT_PAIR
  const manifest = (over: Partial<ArmManifest> = {}): ArmManifest => ({
    schemaVersion: 2,
    sweepId: record.sweepId,
    arm: record.arm,
    ref: 'main',
    commit: 'abc',
    startedAt: record.startedAt,
    endedAt: record.endedAt,
    agents: [
      {
        agentId: record.agentId,
        caseList: 'chief_of_staff.json',
        placeholderCases: false,
        cases: 1,
        attempts: 1,
        recordsWritten: 1,
      },
    ],
    skipped: [],
    spent: true,
    ...over,
  })

  it('passes an arm that captured what it was asked for', () => {
    expect(
      armProblems(
        manifest(),
        [record],
        [record.agentId],
        [record.agentId],
        true,
      ),
    ).toEqual([])
  })

  it('fails an arm that skipped an agent it could have captured', () => {
    expect(
      armProblems(
        manifest({
          agents: [],
          skipped: [{ agentId: record.agentId, reason: 'boom' }],
        }),
        [],
        [record.agentId],
        [record.agentId],
        true,
      ),
    ).toEqual([expect.stringMatching(/could have been captured/)])
  })

  it('passes an arm whose chat agents were refused by design', () => {
    expect(
      armProblems(
        manifest({
          agents: [],
          skipped: [{ agentId: record.agentId, reason: 'no spend' }],
        }),
        [],
        [record.agentId],
        [],
        false,
      ),
    ).toEqual([])
  })
})

// THE ENTRY AS A COMMAND, because a module that exports `main` and never calls
// it prints nothing and exits 0. A dry run of a chat agent has to skip it by
// name in the manifest without a single HTTP call, and say so.
describe('captureArm.ts, run', () => {
  it('skips a chat agent by name on a dry run', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'judge-capture-'))
    const sha = 'a'.repeat(40)
    const output = execFileSync(
      'npx',
      ['tsx', path.join(__dirname, 'captureArm.ts')],
      {
        cwd: path.resolve(__dirname, '../../../..'),
        encoding: 'utf8',
        env: {
          PATH: process.env.PATH,
          HOME: process.env.HOME,
          JUDGE_ARM: 'candidate',
          JUDGE_SWEEP_ID: 'dry-1',
          JUDGE_AGENTS: 'chief_of_staff',
          JUDGE_BASE_REF: 'main',
          JUDGE_CANDIDATE_SHA: sha,
          JUDGE_ARM_COMMIT: sha,
          JUDGE_RECORDS_DIR: dir,
        },
      },
    )
    expect(output).toMatch(/skipped chief_of_staff: JUDGE_SPEND is not "true"/)
    const manifest = ArmManifestSchema.parse(
      JSON.parse(
        await readFile(
          path.join(dir, '_judge', 'dry-1', 'manifests', 'candidate.json'),
          'utf8',
        ),
      ),
    )
    expect(manifest.agents).toEqual([])
    expect(manifest.skipped.map((skip) => skip.agentId)).toEqual([
      'chief_of_staff',
    ])
  }, 120_000)
})
