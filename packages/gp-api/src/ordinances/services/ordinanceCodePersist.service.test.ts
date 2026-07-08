import { subHours, subMinutes } from 'date-fns'
import {
  ExperimentRunStatus,
  OrdinanceConfidence,
  OrdinanceDataQuality,
  OrdinanceHostType,
} from '../../generated/prisma'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { S3Service } from '@/vendors/aws/services/s3.service'
import { useTestService } from '@/test-service'
import { OrdinanceCodePersistService } from './ordinanceCodePersist.service'

const service = useTestService()

const ORG = 'test-org-ordinances'
const BUCKET = 'gp-agent-artifacts-dev'

const seedOrg = async (slug = ORG) => {
  await service.prisma.organization.upsert({
    where: { slug },
    create: { slug, ownerId: service.user.id },
    update: {},
  })
}

const seedRun = async (overrides: {
  experimentType?: string
  status?: ExperimentRunStatus
  artifactKey?: string | null
  artifactBucket?: string | null
  createdAt?: Date
}) =>
  service.prisma.experimentRun.create({
    data: {
      organizationSlug: ORG,
      experimentType: overrides.experimentType ?? 'find_existing_ordinances',
      status: overrides.status ?? ExperimentRunStatus.COMPLETED,
      artifactBucket:
        overrides.artifactBucket === undefined
          ? BUCKET
          : overrides.artifactBucket,
      artifactKey:
        overrides.artifactKey === undefined
          ? `find_existing_ordinances/run/artifact.json`
          : overrides.artifactKey,
      ...(overrides.createdAt ? { createdAt: overrides.createdAt } : {}),
    },
  })

const mockS3 = (responses: Record<string, string | undefined>) =>
  vi
    .spyOn(service.app.get(S3Service), 'getFile')
    .mockImplementation(async (_bucket, key) => responses[key])

// Fixtures mirror real recorded dev runs of find_existing_ordinances.
const municodeArtifact = (
  runId: string,
  overrides: Record<string, unknown> = {},
) => ({
  schema_version: 1,
  organization_slug: ORG,
  generated_for_run_id: runId,
  generated_at: '2026-07-01T12:00:00Z',
  jurisdiction: {
    state: 'CO',
    place: 'Leadville',
    verified_evidence:
      'Municode TOC lists Chapter 6 Business Licenses and Chapter 17 Zoning',
  },
  code_found: true,
  code_source: {
    host_type: 'municode',
    url: 'https://library.municode.com/co/leadville',
    edition_or_date: 'Current through Ordinance 2026-04',
    client_id: '12345',
    product_id: '67890',
  },
  confidence: 'high',
  data_quality: 'ok',
  toc: [
    { title: 'Business Licenses', number: '6' },
    { title: 'Zoning', number: '17' },
  ],
  code_capture: {
    saved: true,
    files: [
      {
        path: 'code/municipal_code.html',
        byte_size: 482133,
        content_type: 'text/html',
        source_url:
          'https://library.municode.com/co/leadville/codes/municipal_code',
      },
    ],
  },
  ...overrides,
})

// found:false but the run still located WHERE ordinances live — the pointer
// url is real data and must persist, not be forced null.
const uncodifiedArtifact = (
  runId: string,
  overrides: Record<string, unknown> = {},
) => ({
  schema_version: 1,
  organization_slug: ORG,
  generated_for_run_id: runId,
  generated_at: '2026-07-02T13:00:00Z',
  jurisdiction: {
    state: 'CO',
    place: 'Leadville',
    verified_evidence:
      'City site publishes ordinances as individual PDFs; no codified volume',
  },
  code_found: false,
  code_source: {
    host_type: 'city_gov',
    url: 'https://www.leadville-co.gov/ordinances',
  },
  confidence: 'medium',
  data_quality: 'uncodified',
  code_capture: {
    saved: false,
    files: [],
    note: 'No codified volume to capture; ordinance index page recorded',
  },
  ...overrides,
})

const notFoundArtifact = (
  runId: string,
  overrides: Record<string, unknown> = {},
) => ({
  schema_version: 1,
  organization_slug: ORG,
  generated_for_run_id: runId,
  generated_at: '2026-07-02T13:00:00Z',
  jurisdiction: {
    state: 'CO',
    place: 'Leadville',
    verified_evidence:
      'No municipal code found on any known host or the city site',
  },
  code_found: false,
  code_source: null,
  confidence: 'low',
  data_quality: 'not_found',
  code_capture: { saved: false, files: [] },
  ...overrides,
})

const persist = () => service.app.get(OrdinanceCodePersistService)

const findRecord = () =>
  service.prisma.ordinanceCodeRecord.findUnique({
    where: { organizationSlug: ORG },
  })

beforeEach(async () => {
  await seedOrg()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('OrdinanceCodePersistService.onExperimentRunCompleted', () => {
  it('ignores runs of other experiment types', async () => {
    const getFile = mockS3({})
    const run = await seedRun({ experimentType: 'meeting_briefing' })

    await persist().onExperimentRunCompleted(run)

    expect(getFile).not.toHaveBeenCalled()
    expect(await findRecord()).toBeNull()
  })

  it('ignores non-COMPLETED runs of the ordinance type', async () => {
    const getFile = mockS3({})
    const run = await seedRun({ status: ExperimentRunStatus.FAILED })

    await persist().onExperimentRunCompleted(run)

    expect(getFile).not.toHaveBeenCalled()
    expect(await findRecord()).toBeNull()
  })

  it('persists a found municode artifact with the full source pointer', async () => {
    const key = 'find_existing_ordinances/run-municode/artifact.json'
    const run = await seedRun({ artifactKey: key })
    mockS3({ [key]: JSON.stringify(municodeArtifact(run.runId)) })

    await persist().onExperimentRunCompleted(run)

    expect(await findRecord()).toMatchObject({
      organizationSlug: ORG,
      codeFound: true,
      dataQuality: OrdinanceDataQuality.OK,
      confidence: OrdinanceConfidence.HIGH,
      hostType: OrdinanceHostType.MUNICODE,
      url: 'https://library.municode.com/co/leadville',
      editionOrDate: 'Current through Ordinance 2026-04',
      clientId: '12345',
      productId: '67890',
      place: 'Leadville',
      state: 'CO',
      verifiedEvidence:
        'Municode TOC lists Chapter 6 Business Licenses and Chapter 17 Zoning',
      artifactBucket: BUCKET,
      artifactKey: key,
      experimentRunId: run.runId,
      verifiedAt: new Date('2026-07-01T12:00:00Z'),
      supersededNote: null,
    })
  })

  it('persists an uncodified found:false artifact keeping its pointer url', async () => {
    const key = 'find_existing_ordinances/run-uncodified/artifact.json'
    const run = await seedRun({ artifactKey: key })
    mockS3({ [key]: JSON.stringify(uncodifiedArtifact(run.runId)) })

    await persist().onExperimentRunCompleted(run)

    expect(await findRecord()).toMatchObject({
      codeFound: false,
      dataQuality: OrdinanceDataQuality.UNCODIFIED,
      confidence: OrdinanceConfidence.MEDIUM,
      hostType: OrdinanceHostType.CITY_GOV,
      url: 'https://www.leadville-co.gov/ordinances',
      clientId: null,
      productId: null,
      experimentRunId: run.runId,
    })
  })

  it('persists a not_found artifact with a null code source', async () => {
    const key = 'find_existing_ordinances/run-notfound/artifact.json'
    const run = await seedRun({ artifactKey: key })
    mockS3({ [key]: JSON.stringify(notFoundArtifact(run.runId)) })

    await persist().onExperimentRunCompleted(run)

    expect(await findRecord()).toMatchObject({
      codeFound: false,
      dataQuality: OrdinanceDataQuality.NOT_FOUND,
      confidence: OrdinanceConfidence.LOW,
      hostType: null,
      url: null,
      editionOrDate: null,
      clientId: null,
      productId: null,
      experimentRunId: run.runId,
    })
  })

  it('retains found data when a newer run concludes found:false, noting why', async () => {
    const foundKey = 'find_existing_ordinances/run-a/artifact.json'
    const runA = await seedRun({
      artifactKey: foundKey,
      createdAt: new Date('2026-07-01T11:00:00Z'),
    })
    mockS3({ [foundKey]: JSON.stringify(municodeArtifact(runA.runId)) })
    await persist().onExperimentRunCompleted(runA)
    vi.restoreAllMocks()

    const regressKey = 'find_existing_ordinances/run-b/artifact.json'
    const runB = await seedRun({
      artifactKey: regressKey,
      createdAt: new Date('2026-07-02T11:00:00Z'),
    })
    mockS3({ [regressKey]: JSON.stringify(uncodifiedArtifact(runB.runId)) })
    await persist().onExperimentRunCompleted(runB)

    const record = await findRecord()
    expect(record).toMatchObject({
      codeFound: true,
      hostType: OrdinanceHostType.MUNICODE,
      url: 'https://library.municode.com/co/leadville',
      dataQuality: OrdinanceDataQuality.OK,
      experimentRunId: runA.runId,
    })
    expect(record?.supersededNote).toContain(runB.runId)
    expect(record?.supersededNote).toContain('uncodified')
  })

  it('replaying the same run result changes nothing', async () => {
    const key = 'find_existing_ordinances/run-replay/artifact.json'
    const run = await seedRun({ artifactKey: key })
    mockS3({ [key]: JSON.stringify(municodeArtifact(run.runId)) })

    await persist().onExperimentRunCompleted(run)
    const first = await findRecord()

    await persist().onExperimentRunCompleted(run)

    expect(await findRecord()).toEqual(first)
  })

  it('replaying the superseding found:false run leaves the record unchanged', async () => {
    const foundKey = 'find_existing_ordinances/run-a2/artifact.json'
    const runA = await seedRun({
      artifactKey: foundKey,
      createdAt: new Date('2026-07-01T11:00:00Z'),
    })
    mockS3({ [foundKey]: JSON.stringify(municodeArtifact(runA.runId)) })
    await persist().onExperimentRunCompleted(runA)
    vi.restoreAllMocks()

    const regressKey = 'find_existing_ordinances/run-b2/artifact.json'
    const runB = await seedRun({
      artifactKey: regressKey,
      createdAt: new Date('2026-07-02T11:00:00Z'),
    })
    mockS3({ [regressKey]: JSON.stringify(uncodifiedArtifact(runB.runId)) })
    await persist().onExperimentRunCompleted(runB)
    const afterFirstReplay = await findRecord()

    await persist().onExperimentRunCompleted(runB)

    expect(await findRecord()).toEqual(afterFirstReplay)
  })

  it('ignores a run older than what the record already reflects', async () => {
    const newerKey = 'find_existing_ordinances/run-newer/artifact.json'
    const newerRun = await seedRun({
      artifactKey: newerKey,
      createdAt: new Date('2026-07-05T11:00:00Z'),
    })
    mockS3({
      [newerKey]: JSON.stringify(
        municodeArtifact(newerRun.runId, {
          generated_at: '2026-07-05T12:00:00Z',
        }),
      ),
    })
    await persist().onExperimentRunCompleted(newerRun)
    vi.restoreAllMocks()

    const olderKey = 'find_existing_ordinances/run-older/artifact.json'
    const olderRun = await seedRun({
      artifactKey: olderKey,
      createdAt: new Date('2026-07-01T00:00:00Z'),
    })
    mockS3({
      [olderKey]: JSON.stringify(
        municodeArtifact(olderRun.runId, {
          generated_at: '2026-07-01T01:00:00Z',
          code_source: {
            host_type: 'ecode360',
            url: 'https://ecode360.com/LE1234',
          },
        }),
      ),
    })
    await persist().onExperimentRunCompleted(olderRun)

    expect(await findRecord()).toMatchObject({
      hostType: OrdinanceHostType.MUNICODE,
      url: 'https://library.municode.com/co/leadville',
      experimentRunId: newerRun.runId,
    })
  })

  it('marks the run failed and throws when the artifact is missing', async () => {
    const run = await seedRun({ artifactKey: 'missing.json' })
    mockS3({})

    await expect(persist().onExperimentRunCompleted(run)).rejects.toThrow(
      'artifact is missing or empty',
    )

    const failed = await service.prisma.experimentRun.findUnique({
      where: { runId: run.runId },
    })
    expect(failed?.status).toBe(ExperimentRunStatus.FAILED)
    expect(failed?.error).toContain('missing')
    expect(await findRecord()).toBeNull()
  })

  it('marks the run failed and throws when the artifact is not JSON', async () => {
    const key = 'not-json.json'
    const run = await seedRun({ artifactKey: key })
    mockS3({ [key]: 'this is not json' })

    await expect(persist().onExperimentRunCompleted(run)).rejects.toThrow()

    const failed = await service.prisma.experimentRun.findUnique({
      where: { runId: run.runId },
    })
    expect(failed?.status).toBe(ExperimentRunStatus.FAILED)
    expect(await findRecord()).toBeNull()
  })

  it('marks the run failed and throws when the artifact fails validation', async () => {
    const key = 'bad-shape.json'
    const run = await seedRun({ artifactKey: key })
    // data_quality is a plain string in the contract; an object here is the
    // exact malformation a drifted agent would emit.
    mockS3({
      [key]: JSON.stringify(
        municodeArtifact(run.runId, { data_quality: { overall: 'ok' } }),
      ),
    })

    await expect(persist().onExperimentRunCompleted(run)).rejects.toThrow()

    const failed = await service.prisma.experimentRun.findUnique({
      where: { runId: run.runId },
    })
    expect(failed?.status).toBe(ExperimentRunStatus.FAILED)
    expect(await findRecord()).toBeNull()
  })

  it('marks the run failed and throws when a completed run has no artifact location', async () => {
    const run = await seedRun({ artifactBucket: null, artifactKey: null })
    const getFile = mockS3({})

    await expect(persist().onExperimentRunCompleted(run)).rejects.toThrow(
      'without an artifact location',
    )

    expect(getFile).not.toHaveBeenCalled()
    const failed = await service.prisma.experimentRun.findUnique({
      where: { runId: run.runId },
    })
    expect(failed?.status).toBe(ExperimentRunStatus.FAILED)
  })

  it('persists an artifact whose code_capture note is null', async () => {
    const key = 'find_existing_ordinances/run-nullnote/artifact.json'
    const run = await seedRun({ artifactKey: key })
    mockS3({
      [key]: JSON.stringify(
        uncodifiedArtifact(run.runId, {
          code_capture: { saved: false, files: [], note: null },
        }),
      ),
    })

    await persist().onExperimentRunCompleted(run)

    expect(await findRecord()).toMatchObject({
      codeFound: false,
      dataQuality: OrdinanceDataQuality.UNCODIFIED,
      experimentRunId: run.runId,
    })
  })

  it('marks the run failed when code_found is true but code_source is null', async () => {
    const key = 'find_existing_ordinances/run-invariant/artifact.json'
    const run = await seedRun({ artifactKey: key })
    mockS3({
      [key]: JSON.stringify(municodeArtifact(run.runId, { code_source: null })),
    })

    await expect(persist().onExperimentRunCompleted(run)).rejects.toThrow(
      /code_source/,
    )

    const failed = await service.prisma.experimentRun.findUnique({
      where: { runId: run.runId },
    })
    expect(failed?.status).toBe(ExperimentRunStatus.FAILED)
    expect(await findRecord()).toBeNull()
  })

  it('marks the run failed when the artifact org slug does not match the run', async () => {
    const key = 'find_existing_ordinances/run-orgmismatch/artifact.json'
    const run = await seedRun({ artifactKey: key })
    mockS3({
      [key]: JSON.stringify(
        municodeArtifact(run.runId, { organization_slug: 'a-different-org' }),
      ),
    })

    await expect(persist().onExperimentRunCompleted(run)).rejects.toThrow(
      /does not match run org/,
    )

    const failed = await service.prisma.experimentRun.findUnique({
      where: { runId: run.runId },
    })
    expect(failed?.status).toBe(ExperimentRunStatus.FAILED)
    expect(await findRecord()).toBeNull()
  })

  it('marks the run failed when the artifact run id does not match the run', async () => {
    const key = 'find_existing_ordinances/run-runmismatch/artifact.json'
    const run = await seedRun({ artifactKey: key })
    mockS3({
      [key]: JSON.stringify(
        municodeArtifact(run.runId, {
          generated_for_run_id: 'a-different-run',
        }),
      ),
    })

    await expect(persist().onExperimentRunCompleted(run)).rejects.toThrow(
      /does not match/,
    )

    const failedRun = await service.prisma.experimentRun.findUnique({
      where: { runId: run.runId },
    })
    expect(failedRun?.status).toBe(ExperimentRunStatus.FAILED)
  })

  it("persists when the artifact carries the contract's unknown run id", async () => {
    const key = 'find_existing_ordinances/run-unknownid/artifact.json'
    const run = await seedRun({ artifactKey: key })
    mockS3({
      [key]: JSON.stringify(
        municodeArtifact(run.runId, { generated_for_run_id: 'unknown' }),
      ),
    })

    await persist().onExperimentRunCompleted(run)

    expect(await findRecord()).toMatchObject({ codeFound: true })
  })

  it('upgrades a not_found record when a later run finds the code', async () => {
    const firstKey = 'find_existing_ordinances/run-neg/artifact.json'
    const firstRun = await seedRun({
      artifactKey: firstKey,
      createdAt: subHours(new Date(), 2),
    })
    mockS3({
      [firstKey]: JSON.stringify(
        municodeArtifact(firstRun.runId, {
          code_found: false,
          code_source: null,
          data_quality: 'not_found',
          confidence: 'low',
        }),
      ),
    })
    await persist().onExperimentRunCompleted(firstRun)
    expect(await findRecord()).toMatchObject({ codeFound: false })

    const secondKey = 'find_existing_ordinances/run-pos/artifact.json'
    const secondRun = await seedRun({ artifactKey: secondKey })
    mockS3({
      [secondKey]: JSON.stringify(municodeArtifact(secondRun.runId)),
    })
    await persist().onExperimentRunCompleted(secondRun)

    expect(await findRecord()).toMatchObject({
      codeFound: true,
      dataQuality: OrdinanceDataQuality.OK,
      experimentRunId: secondRun.runId,
    })
  })

  it('serializes concurrent results so the newer run always wins', async () => {
    const newerKey = 'find_existing_ordinances/run-conc-new/artifact.json'
    const olderKey = 'find_existing_ordinances/run-conc-old/artifact.json'
    const newerRun = await seedRun({
      artifactKey: newerKey,
      createdAt: subMinutes(new Date(), 5),
    })
    const olderRun = await seedRun({
      artifactKey: olderKey,
      createdAt: subHours(new Date(), 2),
    })
    mockS3({
      [newerKey]: JSON.stringify(municodeArtifact(newerRun.runId)),
      [olderKey]: JSON.stringify(
        municodeArtifact(olderRun.runId, {
          code_source: {
            host_type: 'city_gov',
            url: 'https://stale.example.gov/old-code',
          },
        }),
      ),
    })

    await Promise.all([
      persist().onExperimentRunCompleted(newerRun),
      persist().onExperimentRunCompleted(olderRun),
    ])

    expect(await findRecord()).toMatchObject({
      experimentRunId: newerRun.runId,
      hostType: OrdinanceHostType.MUNICODE,
    })
  })

  it('compares run dispatch times, not content times, in the older-run guard', async () => {
    const newerKey = 'find_existing_ordinances/run-newer/artifact.json'
    const newerRun = await seedRun({
      artifactKey: newerKey,
      createdAt: subMinutes(new Date(), 30),
    })
    mockS3({
      [newerKey]: JSON.stringify(
        municodeArtifact(newerRun.runId, {
          // verification content predates BOTH runs' dispatch times
          generated_at: subHours(new Date(), 3).toISOString(),
        }),
      ),
    })
    await persist().onExperimentRunCompleted(newerRun)

    const olderKey = 'find_existing_ordinances/run-older/artifact.json'
    const olderRun = await seedRun({
      artifactKey: olderKey,
      createdAt: subHours(new Date(), 2),
    })
    mockS3({
      [olderKey]: JSON.stringify(
        municodeArtifact(olderRun.runId, {
          code_source: {
            host_type: 'city_gov',
            url: 'https://stale.example.gov/old-code',
          },
        }),
      ),
    })
    await persist().onExperimentRunCompleted(olderRun)

    expect(await findRecord()).toMatchObject({
      codeFound: true,
      experimentRunId: newerRun.runId,
    })
  })

  it('clamps a future generated_at to now when persisting', async () => {
    const key = 'find_existing_ordinances/run-future/artifact.json'
    const run = await seedRun({ artifactKey: key })
    mockS3({
      [key]: JSON.stringify(
        municodeArtifact(run.runId, { generated_at: '2099-01-01T00:00:00Z' }),
      ),
    })

    await persist().onExperimentRunCompleted(run)

    const record = await findRecord()
    expect(record?.verifiedAt.getTime()).toBeLessThanOrEqual(Date.now())
  })
})
