import { createHash } from 'crypto'
import {
  GetObjectCommand,
  type GetObjectCommandOutput,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3'
import { mockClient } from 'aws-sdk-client-mock'
import { beforeEach, describe, expect, it } from 'vitest'
import { createMockLogger } from '@/shared/test-utils/mockLogger.util'
import {
  AgentPageReplayService,
  normalizeReplayUrl,
  replayUrlDigest,
} from './judgeReplay'

// Computed with the broker's own normalize_url (gp-ai
// broker/page_replay.py) under Python 3.14, so a drift in this port fails
// here rather than as silent replay misses.
const BROKER_GOLDEN: [string, string, string][] = [
  [
    'https://Example.COM/Path/To?b=2&a=1#frag',
    'https://example.com/Path/To?a=1&b=2',
    '2e372a5847a854c0cb4d31d1cd155ecd34e1a09d4c1c5b9137d99f0119cd7541',
  ],
  [
    'HTTPS://monroewa.civicweb.net/document/279037/City%20Council%20Business%20Meeting%20-%2010%20Nov%202026.pdf?handle=AE33EC2876D241B4A4404CE1C92C0F99',
    'https://monroewa.civicweb.net/document/279037/City%20Council%20Business%20Meeting%20-%2010%20Nov%202026.pdf?handle=AE33EC2876D241B4A4404CE1C92C0F99',
    '6abe60d89379ef24882a695be074cb8dcb39b1f440eb771a2cd8444bd917670d',
  ],
  [
    'https://x.gov/a?utm_source=g&UTM_Medium=x&fbclid=1&GCLID=2&keep=yes',
    'https://x.gov/a?keep=yes',
    'e020d777022b8f3d0a982055a790619707f168d355178df24ebb2b0bdab0cdf2',
  ],
  [
    'https://x.gov/search?q=city+council&q2=a%20b&empty=&flag',
    'https://x.gov/search?empty=&flag=&q=city+council&q2=a+b',
    '9a820f565287275d267fa1c53585e3ffe377809052b0b55b7866e8a0e9a05f69',
  ],
  [
    'https://x.gov',
    'https://x.gov',
    'a52ce0236c2b65a0caf5c53aaab3bb8d79eeaf34cdf5400308de5b6b782b6563',
  ],
  [
    'https://user:Pw@Host.GOV:8443/p?x=%2Fslash&y=caf%C3%A9&z=~-._*',
    'https://user:Pw@host.gov:8443/p?x=%2Fslash&y=caf%C3%A9&z=~-._%2A',
    'f2c3d9e4bb74126797c2575fec2180d85b7999193828a3a22511b2de0360c8a3',
  ],
  [
    'https://x.gov/p?&&a=1&&',
    'https://x.gov/p?a=1',
    '29fe828fb37a5e79b44f3cd0c7ae5434249535252297d306f7dc635f2b25e615',
  ],
  [
    'https://x.gov/p?b=2&a=2&a=1',
    'https://x.gov/p?a=1&a=2&b=2',
    '00a0ede0480747572505c419449a177c32fae122afe1b51545d973cbaecb7860',
  ],
]

const KEY = '_judge/replay/sweep/s1/meeting_briefing/case-1-1'
const URL_A = 'https://city.gov/agenda'

const streamOf = (text: string) =>
  ({
    transformToString: async () => text,
    transformToByteArray: async () => new Uint8Array(Buffer.from(text)),
  }) as unknown as GetObjectCommandOutput['Body']

const seconds = (s: number) => new Date(s * 1000)

describe('normalizeReplayUrl', () => {
  it.each(BROKER_GOLDEN)('matches the broker for %s', (url, normal, digest) => {
    expect(normalizeReplayUrl(url)).toBe(normal)
    expect(replayUrlDigest(url)).toBe(digest)
  })
})

describe('AgentPageReplayService', () => {
  const s3 = mockClient(S3Client)
  const digest = createHash('sha256')
    .update(normalizeReplayUrl(URL_A))
    .digest('hex')
  const metaKey = `${KEY}/fetch/${digest}.json`
  const bodyKey = `${KEY}/fetch/${digest}.body`
  let service: AgentPageReplayService

  beforeEach(() => {
    s3.reset()
    s3.on(PutObjectCommand).resolves({})
    service = new AgentPageReplayService(
      createMockLogger(),
      new S3Client({ region: 'us-west-2' }),
    )
  })

  const recordPage = (body: string, writtenAt: number, byteSize?: number) => {
    s3.on(GetObjectCommand, { Key: metaKey }).resolves({
      LastModified: seconds(writtenAt),
      Body: streamOf(
        JSON.stringify({
          status: 200,
          content_type: 'text/html',
          final_url: 'https://city.gov/agenda/',
          byte_size: byteSize ?? Buffer.byteLength(body),
        }),
      ),
    })
    s3.on(GetObjectCommand, { Key: bodyKey }).resolves({
      LastModified: seconds(writtenAt),
      Body: streamOf(body),
    })
  }

  const markers = () =>
    s3
      .commandCalls(PutObjectCommand)
      .map((call) => call.args[0].input.Key ?? '')

  it('serves a page recorded before the run was bound, and marks a hit', async () => {
    recordPage('Agenda text', 1_000)
    service.bind('run-1', { mode: 'replay', key: KEY }, 2_000)

    const page = await service.lookupFetch('run-1', `${URL_A}#top`)

    expect(page).toEqual({
      status: 200,
      contentType: 'text/html',
      finalUrl: 'https://city.gov/agenda/',
      body: Buffer.from('Agenda text'),
    })
    expect(markers()).toEqual([
      expect.stringMatching(
        new RegExp(`^${KEY}/outcomes/run-1/fetch-hit-[0-9a-f]{32}$`),
      ),
    ])
  })

  it('misses a recording written after the run was bound', async () => {
    recordPage('Agenda text', 2_000)
    service.bind('run-1', { mode: 'replay', key: KEY }, 2_000)

    expect(await service.lookupFetch('run-1', URL_A)).toBeUndefined()
    expect(markers()[0]).toContain('/fetch-miss-')
  })

  it('misses when the body does not match the recorded size', async () => {
    recordPage('Agenda text', 1_000, 999)
    service.bind('run-1', { mode: 'replay', key: KEY }, 2_000)

    expect(await service.lookupFetch('run-1', URL_A)).toBeUndefined()
  })

  it('misses when nothing was recorded', async () => {
    const missing = Object.assign(new Error('missing'), { name: 'NoSuchKey' })
    s3.on(GetObjectCommand).rejects(missing)
    service.bind('run-1', { mode: 'replay', key: KEY }, 2_000)

    expect(await service.lookupFetch('run-1', URL_A)).toBeUndefined()
    expect(markers()[0]).toContain('/fetch-miss-')
  })

  it('serves a recorded HEAD check', async () => {
    s3.on(GetObjectCommand, { Key: `${KEY}/head/${digest}.json` }).resolves({
      LastModified: seconds(1_000),
      Body: streamOf(
        JSON.stringify({ status: 200, final_url: 'https://city.gov/a/' }),
      ),
    })
    service.bind('run-1', { mode: 'replay', key: KEY }, 2_000)

    expect(await service.lookupHead('run-1', URL_A)).toEqual({
      status: 200,
      finalUrl: 'https://city.gov/a/',
    })
    expect(markers()[0]).toContain('/head-hit-')
  })

  it('leaves unbound, record-mode and released runs live', async () => {
    recordPage('Agenda text', 1_000)
    service.bind('run-record', { mode: 'record', key: KEY }, 2_000)
    service.bind('run-released', { mode: 'replay', key: KEY }, 2_000)
    service.release('run-released')

    expect(await service.lookupFetch('run-unbound', URL_A)).toBeUndefined()
    expect(await service.lookupFetch('run-record', URL_A)).toBeUndefined()
    expect(await service.lookupFetch('run-released', URL_A)).toBeUndefined()
    expect(service.forRun('run-record')).toEqual({ mode: 'record', key: KEY })
    expect(s3.commandCalls(GetObjectCommand)).toHaveLength(0)
  })

  it('rejects a store key outside the judge prefix', () => {
    expect(() =>
      service.bind('run-1', { mode: 'replay', key: '_judge/replay/../x' }),
    ).toThrow()
  })
})
