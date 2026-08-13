import { describe, expect, it } from 'vitest'
import {
  ExperimentRunStatus,
  OrdinanceConfidence,
  OrdinanceDataQuality,
  OrdinanceHostType,
} from '../../generated/prisma'
import { isUniqueConstraintError } from '@/prisma/util/prismaErrors.util'
import { useTestService } from '@/test-service'

const service = useTestService()

const seedOrg = async (slug: string) =>
  service.prisma.organization.create({
    data: { slug, ownerId: service.user.id },
  })

const seedRun = async (orgSlug: string) =>
  service.prisma.experimentRun.create({
    data: {
      organizationSlug: orgSlug,
      experimentType: 'find_existing_ordinances',
      status: ExperimentRunStatus.COMPLETED,
    },
  })

const recordData = (orgSlug: string, experimentRunId?: string) => ({
  organizationSlug: orgSlug,
  codeFound: true,
  dataQuality: OrdinanceDataQuality.OK,
  confidence: OrdinanceConfidence.HIGH,
  hostType: OrdinanceHostType.MUNICODE,
  url: 'https://library.municode.com/co/leadville',
  place: 'Leadville',
  state: 'CO',
  verifiedEvidence: 'TOC lists Chapter 6 Business Licenses',
  artifactBucket: 'gp-agent-artifacts-dev',
  artifactKey: 'find_existing_ordinances/run-1/artifact.json',
  verifiedAt: new Date(),
  ...(experimentRunId ? { experimentRunId } : {}),
})

describe('OrdinanceCodeRecord model', () => {
  it('persists the current record keyed by organization slug', async () => {
    const org = await seedOrg('ord-rec-create')
    const run = await seedRun(org.slug)

    await service.prisma.ordinanceCodeRecord.create({
      data: recordData(org.slug, run.runId),
    })

    const found = await service.prisma.ordinanceCodeRecord.findUnique({
      where: { organizationSlug: org.slug },
    })
    expect(found).toMatchObject({
      organizationSlug: org.slug,
      codeFound: true,
      dataQuality: OrdinanceDataQuality.OK,
      confidence: OrdinanceConfidence.HIGH,
      hostType: OrdinanceHostType.MUNICODE,
      url: 'https://library.municode.com/co/leadville',
      place: 'Leadville',
      state: 'CO',
      experimentRunId: run.runId,
      supersededNote: null,
    })
  })

  it('rejects a second record for the same organization', async () => {
    const org = await seedOrg('ord-rec-singleton')
    await service.prisma.ordinanceCodeRecord.create({
      data: recordData(org.slug),
    })

    const secondCreate = service.prisma.ordinanceCodeRecord
      .create({ data: recordData(org.slug) })
      .then(() => null)
      .catch((err: Error) => err)

    expect(isUniqueConstraintError(await secondCreate)).toBe(true)
  })

  it('keeps the record but nulls the run link when the run is deleted', async () => {
    const org = await seedOrg('ord-rec-run-delete')
    const run = await seedRun(org.slug)
    await service.prisma.ordinanceCodeRecord.create({
      data: recordData(org.slug, run.runId),
    })

    await service.prisma.experimentRun.delete({
      where: { runId: run.runId },
    })

    const found = await service.prisma.ordinanceCodeRecord.findUnique({
      where: { organizationSlug: org.slug },
    })
    expect(found?.experimentRunId).toBeNull()
    expect(found?.codeFound).toBe(true)
  })

  it('is deleted when its organization is deleted', async () => {
    const org = await seedOrg('ord-rec-org-delete')
    await service.prisma.ordinanceCodeRecord.create({
      data: recordData(org.slug),
    })

    await service.prisma.organization.delete({ where: { slug: org.slug } })

    const count = await service.prisma.ordinanceCodeRecord.count({
      where: { organizationSlug: org.slug },
    })
    expect(count).toBe(0)
  })
})
