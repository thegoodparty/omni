import { describe, expect, it } from 'vitest'
import {
  OrdinanceConfidence,
  OrdinanceDataQuality,
  OrdinanceHostType,
} from '@/generated/prisma'
import { useTestService } from '@/test-service'

const service = useTestService()

const seedRecord = async (slug: string, ownerId: number) => {
  await service.prisma.organization.create({ data: { slug, ownerId } })
  return service.prisma.ordinanceCodeRecord.create({
    data: {
      organizationSlug: slug,
      codeFound: true,
      dataQuality: OrdinanceDataQuality.OK,
      confidence: OrdinanceConfidence.HIGH,
      hostType: OrdinanceHostType.MUNICODE,
      url: 'https://library.municode.com/co/leadville',
      editionOrDate: 'Supp. 12, 2026-03-01',
      place: 'Leadville',
      state: 'CO',
      verifiedEvidence: 'TOC lists Chapter 6 Business Licenses',
      artifactBucket: 'gp-agent-artifacts-dev',
      artifactKey: 'find_existing_ordinances/run-1/artifact.json',
      verifiedAt: new Date('2026-06-30T12:00:00.000Z'),
    },
  })
}

describe('GET /v1/organizations/:slug/ordinance-code', () => {
  it('returns the record without internal artifact pointers', async () => {
    await seedRecord('ord-read-owner', service.user.id)

    const res = await service.client.get(
      '/v1/organizations/ord-read-owner/ordinance-code',
    )

    expect(res.status).toBe(200)
    expect(res.data).toEqual({
      codeFound: true,
      dataQuality: 'ok',
      confidence: 'high',
      hostType: 'municode',
      url: 'https://library.municode.com/co/leadville',
      editionOrDate: 'Supp. 12, 2026-03-01',
      place: 'Leadville',
      state: 'CO',
      verifiedAt: '2026-06-30T12:00:00.000Z',
    })
  })

  it('serves a not_found record with null host fields intact', async () => {
    await service.prisma.organization.create({
      data: { slug: 'ord-read-notfound', ownerId: service.user.id },
    })
    await service.prisma.ordinanceCodeRecord.create({
      data: {
        organizationSlug: 'ord-read-notfound',
        codeFound: false,
        dataQuality: OrdinanceDataQuality.NOT_FOUND,
        confidence: OrdinanceConfidence.LOW,
        hostType: null,
        url: null,
        editionOrDate: null,
        place: 'Nowhere',
        state: 'GA',
        verifiedEvidence: 'no code located online',
        artifactBucket: 'gp-agent-artifacts-dev',
        artifactKey: 'find_existing_ordinances/run-nf/artifact.json',
        verifiedAt: new Date('2026-06-30T12:00:00.000Z'),
      },
    })

    const res = await service.client.get(
      '/v1/organizations/ord-read-notfound/ordinance-code',
    )

    expect(res.status).toBe(200)
    expect(res.data).toMatchObject({
      codeFound: false,
      dataQuality: 'not_found',
      confidence: 'low',
      hostType: null,
      url: null,
      editionOrDate: null,
    })
  })

  it('404s when the organization has no record', async () => {
    await service.prisma.organization.create({
      data: { slug: 'ord-read-empty', ownerId: service.user.id },
    })

    const res = await service.client.get(
      '/v1/organizations/ord-read-empty/ordinance-code',
    )

    expect(res.status).toBe(404)
  })

  it('404s for a user who does not own the organization', async () => {
    const otherOwner = await service.prisma.user.create({
      data: { email: 'other-owner@goodparty.org' },
    })
    await seedRecord('ord-read-other', otherOwner.id)

    const res = await service.client.get(
      '/v1/organizations/ord-read-other/ordinance-code',
    )

    expect(res.status).toBe(404)
  })
})
