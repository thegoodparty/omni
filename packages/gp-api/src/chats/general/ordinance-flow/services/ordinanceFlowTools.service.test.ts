import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NotFoundException } from '@nestjs/common'
import { useTestService } from '@/test-service'
import { S3Service } from '@/vendors/aws/services/s3.service'
import { OrdinanceFlowToolsService } from './ordinanceFlowTools.service'

const service = useTestService()

const seedOrdinance = async (userId: number) => {
  const slug = `tools-eo-${userId}-${Math.random().toString(36).slice(2, 10)}`
  await service.prisma.organization.create({
    data: { slug, ownerId: userId },
  })
  const electedOffice = await service.prisma.electedOffice.create({
    data: { organizationSlug: slug, userId },
  })
  const ordinance = await service.prisma.ordinance.create({
    data: { electedOfficeId: electedOffice.id, seedType: 'new' },
  })
  return {
    organizationSlug: slug,
    electedOfficeId: electedOffice.id,
    ordinanceId: ordinance.id,
  }
}

const seedCodeRecord = async (organizationSlug: string) =>
  service.prisma.ordinanceCodeRecord.create({
    data: {
      organizationSlug,
      codeFound: true,
      dataQuality: 'OK',
      confidence: 'HIGH',
      hostType: 'MUNICODE',
      url: 'https://library.municode.com/nc/hendersonville',
      editionOrDate: 'current through Ord. 25-01',
      clientId: '12345',
      productId: '67890',
      place: 'Hendersonville',
      state: 'NC',
      verifiedEvidence: 'Homepage lists City of Hendersonville, NC.',
      artifactBucket: 'gp-agent-artifacts-test',
      artifactKey: 'find_existing_ordinances/run-1/output.json',
      supersededNote: 'internal: kept over run-0',
      verifiedAt: new Date(),
    },
  })

const artifactJson = (organizationSlug: string) =>
  JSON.stringify({
    schema_version: 1,
    organization_slug: organizationSlug,
    generated_for_run_id: 'run-1',
    generated_at: '2026-07-01T00:00:00Z',
    jurisdiction: {
      state: 'NC',
      place: 'Hendersonville',
      verified_evidence: 'Homepage lists City of Hendersonville, NC.',
    },
    code_found: true,
    code_source: {
      host_type: 'municode',
      url: 'https://library.municode.com/nc/hendersonville',
    },
    confidence: 'high',
    data_quality: 'ok',
    toc: [
      { title: 'Chapter 1 - General Provisions', number: '1' },
      { title: 'Chapter 9 - Noise', number: '9' },
    ],
    code_capture: { saved: false, files: [], note: 'pointer-only' },
  })

describe('OrdinanceFlowToolsService', () => {
  let tools: OrdinanceFlowToolsService
  let ordinanceId: string
  let electedOfficeId: string
  let organizationSlug: string

  beforeEach(async () => {
    tools = service.app.get(OrdinanceFlowToolsService)
    ;({ ordinanceId, electedOfficeId, organizationSlug } = await seedOrdinance(
      service.user.id,
    ))
  })

  it('records and re-records clarify answers (replace, not duplicate)', async () => {
    await tools.appendAnswer(ordinanceId, electedOfficeId, {
      questionId: 'q1',
      question: 'What hours?',
      answer: '10pm to 7am',
    })
    await tools.appendAnswer(ordinanceId, electedOfficeId, {
      questionId: 'q2',
      question: 'Any exemptions?',
      answer: 'Emergencies',
    })
    // Re-answering q1 replaces it rather than appending a duplicate.
    await tools.appendAnswer(ordinanceId, electedOfficeId, {
      questionId: 'q1',
      question: 'What hours?',
      answer: '11pm to 6am',
    })

    const read = await tools.readSection(
      ordinanceId,
      electedOfficeId,
      'clarify_answers',
    )
    const answers = read.clarifyAnswers as Array<{
      questionId: string
      answer: string
    }>
    expect(answers).toHaveLength(2)
    expect(answers.find((a) => a.questionId === 'q1')?.answer).toBe(
      '11pm to 6am',
    )
  })

  it('appends scratchpad notes tagged with the step', async () => {
    await tools.appendNote(
      ordinanceId,
      electedOfficeId,
      'clarify',
      'Wants teeth',
    )
    const read = await tools.readSection(
      ordinanceId,
      electedOfficeId,
      'scratchpad',
    )
    const notes = read.scratchpad as Array<{ step: string; text: string }>
    expect(notes).toHaveLength(1)
    expect(notes[0]).toMatchObject({ step: 'clarify', text: 'Wants teeth' })
  })

  it('saves a clarify synthesis', async () => {
    await tools.saveSynthesis(ordinanceId, electedOfficeId, {
      synthesis: 'Nighttime noise limit with emergency carve-outs.',
    })
    const read = await tools.readSection(
      ordinanceId,
      electedOfficeId,
      'clarify',
    )
    expect(read.clarify).toMatchObject({
      synthesis: 'Nighttime noise limit with emergency carve-outs.',
    })
  })

  it('reports the code source as unavailable when no record exists', async () => {
    const result = await tools.getCodeSource(
      ordinanceId,
      electedOfficeId,
      organizationSlug,
    )
    expect(result).toMatchObject({ available: false, reason: 'no_record' })
  })

  it('returns the code source with lowercase enums and no internal fields', async () => {
    await seedCodeRecord(organizationSlug)
    vi.spyOn(service.app.get(S3Service), 'getFile').mockResolvedValue(undefined)

    const result = await tools.getCodeSource(
      ordinanceId,
      electedOfficeId,
      organizationSlug,
    )
    if (!result.available) throw new Error('expected available')
    expect(result.source).toMatchObject({
      codeFound: true,
      dataQuality: 'ok',
      confidence: 'high',
      hostType: 'municode',
      url: 'https://library.municode.com/nc/hendersonville',
      place: 'Hendersonville',
      state: 'NC',
    })
    expect(result.verifiedEvidence).toContain('Hendersonville')
    const dumped = JSON.stringify(result)
    expect(dumped).not.toContain('gp-agent-artifacts-test')
    expect(dumped).not.toContain('find_existing_ordinances/run-1')
    expect(dumped).not.toContain('kept over run-0')
  })

  it('includes the table of contents from the S3 artifact when present', async () => {
    await seedCodeRecord(organizationSlug)
    vi.spyOn(service.app.get(S3Service), 'getFile').mockResolvedValue(
      artifactJson(organizationSlug),
    )

    const result = await tools.getCodeSource(
      ordinanceId,
      electedOfficeId,
      organizationSlug,
    )
    if (!result.available) throw new Error('expected available')
    expect(result.toc).toEqual([
      { title: 'Chapter 1 - General Provisions', number: '1' },
      { title: 'Chapter 9 - Noise', number: '9' },
    ])
  })

  it('omits the toc when the artifact is missing or malformed', async () => {
    await seedCodeRecord(organizationSlug)
    vi.spyOn(service.app.get(S3Service), 'getFile').mockResolvedValue(
      'not json',
    )

    const result = await tools.getCodeSource(
      ordinanceId,
      electedOfficeId,
      organizationSlug,
    )
    if (!result.available) throw new Error('expected available')
    expect(result.toc).toBeUndefined()
  })

  it('handles a record with a null source pointer group', async () => {
    await service.prisma.ordinanceCodeRecord.create({
      data: {
        organizationSlug,
        codeFound: false,
        dataQuality: 'NOT_FOUND',
        confidence: 'LOW',
        place: 'Hendersonville',
        state: 'NC',
        verifiedEvidence: 'No code located for this jurisdiction.',
        artifactBucket: 'gp-agent-artifacts-test',
        artifactKey: 'find_existing_ordinances/run-2/output.json',
        verifiedAt: new Date(),
      },
    })
    vi.spyOn(service.app.get(S3Service), 'getFile').mockResolvedValue(undefined)

    const result = await tools.getCodeSource(
      ordinanceId,
      electedOfficeId,
      organizationSlug,
    )
    if (!result.available) throw new Error('expected available')
    expect(result.source).toMatchObject({
      codeFound: false,
      dataQuality: 'not_found',
      hostType: null,
      url: null,
    })
  })

  it('degrades to unavailable when S3 rejects while reading the toc', async () => {
    await seedCodeRecord(organizationSlug)
    vi.spyOn(service.app.get(S3Service), 'getFile').mockRejectedValue(
      new Error('s3 down'),
    )

    const result = await tools.getCodeSource(
      ordinanceId,
      electedOfficeId,
      organizationSlug,
    )
    // An S3 outage drops only the toc; the source pointer still resolves.
    if (!result.available) throw new Error('expected available')
    expect(result.toc).toBeUndefined()
    expect(result.source.url).toBe(
      'https://library.municode.com/nc/hendersonville',
    )
  })

  it('persists current-law findings readable by later steps', async () => {
    await tools.saveExistingLaw(ordinanceId, electedOfficeId, {
      sourceUrl: 'https://library.municode.com/nc/hendersonville/ch12',
      chapterLabel: 'Chapter 12, Public Safety Surveillance',
      text: 'Allows cameras in public rights-of-way; no retention limit.',
    })
    const read = await tools.readSection(
      ordinanceId,
      electedOfficeId,
      'current_law',
    )
    expect(read.currentLaw).toMatchObject({
      sourceUrl: 'https://library.municode.com/nc/hendersonville/ch12',
      chapterLabel: 'Chapter 12, Public Safety Surveillance',
      text: 'Allows cameras in public rights-of-way; no retention limit.',
    })
    const law = read.currentLaw as { fetchedAt: string }
    expect(new Date(law.fetchedAt).getTime()).not.toBeNaN()
  })

  it('overwrites current-law findings on a second save (last write wins)', async () => {
    await tools.saveExistingLaw(ordinanceId, electedOfficeId, {
      sourceUrl: 'https://example.gov/ch12',
      text: 'First pass summary.',
    })
    await tools.saveExistingLaw(ordinanceId, electedOfficeId, {
      sourceUrl: 'https://example.gov/ch12-rev',
      text: 'Revised summary after reading more chapters.',
    })
    const read = await tools.readSection(
      ordinanceId,
      electedOfficeId,
      'current_law',
    )
    expect(read.currentLaw).toMatchObject({
      sourceUrl: 'https://example.gov/ch12-rev',
      text: 'Revised summary after reading more chapters.',
    })
  })

  it('scopes every operation to the owning office', async () => {
    await expect(
      tools.appendNote(ordinanceId, 'someone-elses-office', 'clarify', 'x'),
    ).rejects.toBeInstanceOf(NotFoundException)
    await expect(
      tools.readSection(ordinanceId, 'someone-elses-office', 'draft'),
    ).rejects.toBeInstanceOf(NotFoundException)
  })
})
