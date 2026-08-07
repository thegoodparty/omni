import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NotFoundException } from '@nestjs/common'
import type { OrdinanceSource } from '@goodparty_org/contracts'
import { useTestService } from '@/test-service'
import { OrdinanceQualityLoopStatus, OrdinanceStatus } from '@/generated/prisma'
import { firstOrThrow } from '@/shared/test-utils'
import { S3Service } from '@/vendors/aws/services/s3.service'
import { OrdinanceQualityLoopService } from '@/ordinances/services/ordinanceQualityLoop.service'
import { OrdinanceFlowToolsService } from './ordinanceFlowTools.service'
import { OrdinanceFlowFetchService } from './ordinanceFlowFetch.service'
import { OrdinanceFlowSearchService } from './ordinanceFlowSearch.service'
import {
  buildPresentAuthorityFindingTool,
  buildPresentComparablesTool,
  buildPresentCurrentLawSummaryTool,
  buildPresentDraftTool,
  buildPresentLegislativeHistoryTool,
  type OrdinanceToolDeps,
} from '../tools/ordinanceFlowTools'

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

  it('accumulates flow token usage across turns on the ordinance record', async () => {
    await tools.recordFlowUsage({
      ordinanceId,
      electedOfficeId,
      step: 'clarify',
      model: 'claude-sonnet-4-6',
      inputTokens: 1200,
      outputTokens: 300,
    })
    await tools.recordFlowUsage({
      ordinanceId,
      electedOfficeId,
      step: 'authority',
      model: 'claude-sonnet-4-6',
      inputTokens: 800,
      outputTokens: 150,
    })
    const row = await service.prisma.ordinance.findUniqueOrThrow({
      where: { id: ordinanceId },
    })
    expect(row.flowInputTokens).toBe(2000)
    expect(row.flowOutputTokens).toBe(450)
  })

  it('does not record usage against an ordinance the office does not own', async () => {
    const other = await seedOrdinance(service.user.id)
    await tools.recordFlowUsage({
      ordinanceId,
      electedOfficeId: other.electedOfficeId,
      step: 'clarify',
      model: 'claude-sonnet-4-6',
      inputTokens: 500,
      outputTokens: 100,
    })
    const row = await service.prisma.ordinance.findUniqueOrThrow({
      where: { id: ordinanceId },
    })
    expect(row.flowInputTokens).toBe(0)
    expect(row.flowOutputTokens).toBe(0)
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
      verbatimText: 'Sec. 12-1. Cameras may be installed in public places.',
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
      verbatimText: 'Sec. 12-1. Cameras may be installed in public places.',
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

  it('persists the authority finding artifact readable by later steps', async () => {
    await tools.saveAuthority(ordinanceId, electedOfficeId, {
      status: 'pass',
      explanation: 'The council may regulate camera siting under G.S. 160A.',
      source: { id: 'gs-160a', title: 'N.C.G.S. § 160A-4' },
    })
    const read = await tools.readSection(
      ordinanceId,
      electedOfficeId,
      'authority',
    )
    expect(read.authority).toMatchObject({
      status: 'pass',
      explanation: 'The council may regulate camera siting under G.S. 160A.',
      source: { id: 'gs-160a', title: 'N.C.G.S. § 160A-4' },
    })
  })

  it('persists the comparables artifact readable by later steps', async () => {
    await tools.saveComparables(ordinanceId, electedOfficeId, [
      {
        city: 'Edgewater',
        state: 'OR',
        status: 'passed',
        quote: 'Cameras sited by published crime-density data.',
        source: { id: 'edg-2022', title: 'Edgewater Ord. 2022-09' },
      },
    ])
    const read = await tools.readSection(
      ordinanceId,
      electedOfficeId,
      'comparables',
    )
    const comparables = read.comparables as Array<{ city: string }>
    expect(comparables).toHaveLength(1)
    expect(comparables[0]).toMatchObject({
      city: 'Edgewater',
      status: 'passed',
    })
  })

  it('persists the draft and flips the ordinance status to draft', async () => {
    await tools.saveDraft(ordinanceId, electedOfficeId, {
      title: 'Draft amendment to Chapter 12, Public Safety Surveillance',
      body: 'Section 12.20  Retention.\n\n(a) Footage deleted after thirty (30) days.',
      sources: [{ id: 'ch12', title: 'Chapter 12' }],
    })
    const read = await tools.readSection(ordinanceId, electedOfficeId, 'draft')
    expect(read.draft).toMatchObject({
      title: 'Draft amendment to Chapter 12, Public Safety Surveillance',
      body: 'Section 12.20  Retention.\n\n(a) Footage deleted after thirty (30) days.',
      sources: [{ id: 'ch12', title: 'Chapter 12' }],
    })
    const row = await service.prisma.ordinance.findUniqueOrThrow({
      where: { id: ordinanceId },
    })
    expect(row.status).toBe('draft')
  })

  it('applyDraftEdit writes the body in place, leaving status, title, and sources untouched', async () => {
    await service.prisma.ordinance.update({
      where: { id: ordinanceId },
      data: {
        status: OrdinanceStatus.proposed,
        draftTitle: 'Keep this title',
        draftBody: 'The fee shall be $50.',
        draftSources: [{ id: 's1', title: 'Chapter 12' }],
      },
    })

    await tools.applyDraftEdit(ordinanceId, electedOfficeId, {
      body: 'The fee shall be {-$50-}{+$75+}.',
    })

    const row = await service.prisma.ordinance.findUniqueOrThrow({
      where: { id: ordinanceId },
    })
    expect(row.draftBody).toBe('The fee shall be {-$50-}{+$75+}.')
    expect(row.draftTitle).toBe('Keep this title')
    expect(row.status).toBe(OrdinanceStatus.proposed)
    expect(row.draftSources).toEqual([{ id: 's1', title: 'Chapter 12' }])
  })

  it('scopes every operation to the owning office', async () => {
    await expect(
      tools.appendNote(ordinanceId, 'someone-elses-office', 'clarify', 'x'),
    ).rejects.toBeInstanceOf(NotFoundException)
    await expect(
      tools.applyDraftEdit(ordinanceId, 'someone-elses-office', { body: 'b' }),
    ).rejects.toBeInstanceOf(NotFoundException)
    await expect(
      tools.readSection(ordinanceId, 'someone-elses-office', 'draft'),
    ).rejects.toBeInstanceOf(NotFoundException)
    await expect(
      tools.saveAuthority(ordinanceId, 'someone-elses-office', {
        status: 'pass',
        explanation: 'x',
        source: { id: 's', title: 't' },
      }),
    ).rejects.toBeInstanceOf(NotFoundException)
    await expect(
      tools.saveComparables(ordinanceId, 'someone-elses-office', []),
    ).rejects.toBeInstanceOf(NotFoundException)
    await expect(
      tools.saveDraft(ordinanceId, 'someone-elses-office', {
        title: 't',
        body: 'b',
      }),
    ).rejects.toBeInstanceOf(NotFoundException)
  })
})

describe('ordinance-flow present_* tool builders', () => {
  let tools: OrdinanceFlowToolsService
  let deps: OrdinanceToolDeps
  let ordinanceId: string
  let electedOfficeId: string

  beforeEach(async () => {
    tools = service.app.get(OrdinanceFlowToolsService)
    ;({ ordinanceId, electedOfficeId } = await seedOrdinance(service.user.id))
    deps = {
      service: tools,
      fetch: service.app.get(OrdinanceFlowFetchService),
      search: service.app.get(OrdinanceFlowSearchService),
      ordinanceId,
      electedOfficeId,
      organizationSlug: 'org-unused',
      step: 'authority',
    }
  })

  it('present_authority_finding persists only the artifact subset', async () => {
    await buildPresentAuthorityFindingTool(deps).execute({
      headline: 'Pass. The council has authority to act.',
      status: 'pass',
      explanation: 'Local surveillance policy sits inside council powers.',
      source: { id: 'ors-181a', title: 'Or. Rev. Stat. § 181A.250' },
      confirmation: 'You can introduce this as an amendment.',
    })
    const read = await tools.readSection(
      ordinanceId,
      electedOfficeId,
      'authority',
    )
    // The display fields (headline, confirmation) render from the tool args;
    // only the OrdinanceAuthoritySchema subset is persisted to the column.
    expect(read.authority).toMatchObject({
      status: 'pass',
      explanation: 'Local surveillance policy sits inside council powers.',
    })
    const dumped = JSON.stringify(read.authority)
    expect(dumped).not.toContain('headline')
    expect(dumped).not.toContain('confirmation')
  })

  it('present_comparables persists the cards, not the framing prose', async () => {
    await buildPresentComparablesTool(deps).execute({
      intro: 'I pulled the closest comparable ordinances.',
      comparables: [
        {
          city: 'Riverton',
          state: 'WA',
          status: 'passed',
          quote: 'Independent oversight panel reviews footage requests.',
          source: { id: 'riv-2021', title: 'Riverton Ord. 2021-14' },
        },
      ],
      takeaway: 'Pair expansion with oversight.',
    })
    const read = await tools.readSection(
      ordinanceId,
      electedOfficeId,
      'comparables',
    )
    const comparables = read.comparables as Array<{ city: string }>
    expect(comparables).toHaveLength(1)
    expect(comparables[0]).toMatchObject({ city: 'Riverton' })
    const dumped = JSON.stringify(read.comparables)
    expect(dumped).not.toContain('I pulled the closest')
    expect(dumped).not.toContain('Pair expansion')
  })

  it('present_draft persists the durable subset, not the description framing', async () => {
    await buildPresentDraftTool(deps).execute({
      title: 'Draft amendment to Chapter 12, Public Safety Surveillance',
      description: 'Adds a 30-day retention limit and an annual audit.',
      body: 'Section 12.20  Retention.\n\n(a) Footage deleted after thirty (30) days.',
      sources: [{ id: 'ch12', title: 'Chapter 12' }],
    })
    const read = await tools.readSection(ordinanceId, electedOfficeId, 'draft')
    const draft = read.draft as {
      title: string
      body: string
      sources: OrdinanceSource[]
    }
    expect(draft.title).toContain('Chapter 12')
    expect(draft.body).toContain('thirty (30) days')
    expect(draft.sources).toHaveLength(1)
    // description is render-only (replayed from the persisted tool args); no
    // draft column holds it.
    expect(draft).not.toHaveProperty('description')
    const row = await service.prisma.ordinance.findUniqueOrThrow({
      where: { id: ordinanceId },
    })
    expect(row.status).toBe('draft')
  })

  it('reads the draft section as null before any draft is saved', async () => {
    const read = await tools.readSection(ordinanceId, electedOfficeId, 'draft')
    expect(read.draft).toBeNull()
  })

  it('reads the draft section as null when only one draft field is set', async () => {
    await service.prisma.ordinance.update({
      where: { id: ordinanceId },
      data: { draftTitle: 'Title only, no body' },
    })
    const read = await tools.readSection(ordinanceId, electedOfficeId, 'draft')
    expect(read.draft).toBeNull()
  })

  it('saveDraft advances in_progress to draft but never downgrades an advanced status', async () => {
    // A re-draft of an ordinance that already advanced past draft must not
    // regress its lifecycle status.
    await service.prisma.ordinance.update({
      where: { id: ordinanceId },
      data: { status: 'proposed' },
    })
    await tools.saveDraft(ordinanceId, electedOfficeId, {
      title: 'Revised draft',
      body: 'Section 1. Revised.',
    })
    const row = await service.prisma.ordinance.findUniqueOrThrow({
      where: { id: ordinanceId },
    })
    expect(row.status).toBe('proposed')
    expect(row.draftBody).toBe('Section 1. Revised.')
  })

  it('saveDraft leaves prior sources intact when a re-draft omits or empties them', async () => {
    await tools.saveDraft(ordinanceId, electedOfficeId, {
      title: 'First draft',
      body: 'Section 1.',
      sources: [{ id: 's1', title: 'Source one' }],
    })
    // Omitted sources preserve the prior list.
    await tools.saveDraft(ordinanceId, electedOfficeId, {
      title: 'Second draft',
      body: 'Section 1 revised.',
    })
    // An empty array (the sourceless default the agent can re-emit) must also
    // preserve, not wipe.
    await tools.saveDraft(ordinanceId, electedOfficeId, {
      title: 'Third draft',
      body: 'Section 1 revised again.',
      sources: [],
    })
    const read = await tools.readSection(ordinanceId, electedOfficeId, 'draft')
    const draft = read.draft as { sources: OrdinanceSource[] }
    expect(draft.sources).toEqual([{ id: 's1', title: 'Source one' }])
  })

  describe('quality loop hooks', () => {
    const seedRunningLoop = () =>
      service.prisma.ordinance.update({
        where: { id: ordinanceId },
        data: {
          status: OrdinanceStatus.draft,
          draftTitle: 'Existing draft',
          draftBody: 'Section 1. Existing text.',
          qualityLoopStatus: OrdinanceQualityLoopStatus.running,
          qualityLoopRunId: 'run-hook',
          qualityLoopUpdatedAt: new Date(),
        },
      })

    const loopStatus = async () =>
      (
        await service.prisma.ordinance.findUniqueOrThrow({
          where: { id: ordinanceId },
        })
      ).qualityLoopStatus

    it('saveDraft auto-starts a loop with the freshly saved draft', async () => {
      const startSpy = vi
        .spyOn(service.app.get(OrdinanceQualityLoopService), 'start')
        .mockResolvedValue({ started: true })

      await tools.saveDraft(ordinanceId, electedOfficeId, {
        title: 'Camera siting ordinance',
        body: 'Section 1. Cameras shall be sited by crime-density data.',
      })

      await vi.waitFor(() => expect(startSpy).toHaveBeenCalledTimes(1))
      const input = firstOrThrow(firstOrThrow(startSpy.mock.calls))
      expect(input.trigger).toBe('auto')
      expect(input.userId).toBe(service.user.id)
      expect(input.ordinance.id).toBe(ordinanceId)
      expect(input.ordinance.draftBody).toBe(
        'Section 1. Cameras shall be sited by crime-density data.',
      )
    })

    it('saveDraft resolves even when the loop start rejects', async () => {
      vi.spyOn(
        service.app.get(OrdinanceQualityLoopService),
        'start',
      ).mockRejectedValue(new Error('enqueue exploded'))

      await expect(
        tools.saveDraft(ordinanceId, electedOfficeId, {
          title: 'T',
          body: 'Section 1.',
        }),
      ).resolves.toEqual({ saved: true })
    })

    it('applyDraftEdit does not auto-start a loop (unlike saveDraft)', async () => {
      const startSpy = vi
        .spyOn(service.app.get(OrdinanceQualityLoopService), 'start')
        .mockResolvedValue({ started: true })

      await tools.applyDraftEdit(ordinanceId, electedOfficeId, {
        body: 'Section 1. {-old-}{+new+}.',
      })

      expect(startSpy).not.toHaveBeenCalled()
    })

    it('applyDraftEdit supersedes a running loop', async () => {
      await seedRunningLoop()

      await tools.applyDraftEdit(ordinanceId, electedOfficeId, {
        body: 'Section 1. {-Existing text-}{+Edited text+}.',
      })

      expect(await loopStatus()).toBe(
        OrdinanceQualityLoopStatus.superseded_by_edit,
      )
    })

    it('saveAuthority supersedes a running loop', async () => {
      await seedRunningLoop()

      await tools.saveAuthority(ordinanceId, electedOfficeId, {
        status: 'pass',
        explanation: 'Within council power.',
        source: { id: 'gs-160a', title: 'N.C.G.S. § 160A-4' },
      })

      expect(await loopStatus()).toBe(
        OrdinanceQualityLoopStatus.superseded_by_edit,
      )
    })

    it('saveComparables supersedes a running loop', async () => {
      await seedRunningLoop()

      await tools.saveComparables(ordinanceId, electedOfficeId, [])

      expect(await loopStatus()).toBe(
        OrdinanceQualityLoopStatus.superseded_by_edit,
      )
    })

    it('saveExistingLaw supersedes a running loop', async () => {
      await seedRunningLoop()

      await tools.saveExistingLaw(ordinanceId, electedOfficeId, {
        sourceUrl: 'https://library.municode.com/nc/hendersonville',
        text: 'Chapter 12 regulates surveillance.',
      })

      expect(await loopStatus()).toBe(
        OrdinanceQualityLoopStatus.superseded_by_edit,
      )
    })

    it('saveAuthority leaves the loop intact when the write itself fails', async () => {
      await seedRunningLoop()
      vi.spyOn(service.prisma.ordinance, 'update').mockRejectedValueOnce(
        new Error('db exploded'),
      )

      await expect(
        tools.saveAuthority(ordinanceId, electedOfficeId, {
          status: 'pass',
          explanation: 'Within council power.',
          source: { id: 'gs-160a', title: 'N.C.G.S. § 160A-4' },
        }),
      ).rejects.toThrow('db exploded')

      expect(await loopStatus()).toBe(OrdinanceQualityLoopStatus.running)
    })

    it('saveComparables leaves the loop intact when the write itself fails', async () => {
      await seedRunningLoop()
      vi.spyOn(service.prisma.ordinance, 'update').mockRejectedValueOnce(
        new Error('db exploded'),
      )

      await expect(
        tools.saveComparables(ordinanceId, electedOfficeId, []),
      ).rejects.toThrow('db exploded')

      expect(await loopStatus()).toBe(OrdinanceQualityLoopStatus.running)
    })

    it('saveExistingLaw leaves the loop intact when the write itself fails', async () => {
      await seedRunningLoop()
      vi.spyOn(service.prisma.ordinance, 'update').mockRejectedValueOnce(
        new Error('db exploded'),
      )

      await expect(
        tools.saveExistingLaw(ordinanceId, electedOfficeId, {
          sourceUrl: 'https://library.municode.com/nc/hendersonville',
          text: 'Chapter 12 regulates surveillance.',
        }),
      ).rejects.toThrow('db exploded')

      expect(await loopStatus()).toBe(OrdinanceQualityLoopStatus.running)
    })

    it('saveAuthority leaves a non-running loop status untouched', async () => {
      await seedRunningLoop()
      await service.prisma.ordinance.update({
        where: { id: ordinanceId },
        data: { qualityLoopStatus: OrdinanceQualityLoopStatus.converged },
      })

      await tools.saveAuthority(ordinanceId, electedOfficeId, {
        status: 'pass',
        explanation: 'Within council power.',
        source: { id: 'gs-160a', title: 'N.C.G.S. § 160A-4' },
      })

      expect(await loopStatus()).toBe(OrdinanceQualityLoopStatus.converged)
    })
  })

  it('display-only present tools ack without persisting or throwing', async () => {
    const summary = await buildPresentCurrentLawSummaryTool().execute({
      chapterLabel: 'Chapter 12',
      does: [{ title: 'Police may install cameras' }],
      gaps: [{ title: 'No retention limit' }],
    })
    const history = await buildPresentLegislativeHistoryTool().execute({
      entries: [{ year: 1998, label: 'Chapter 12 created', summary: 'Pilot.' }],
    })
    expect(summary).toEqual({ presented: true })
    expect(history).toEqual({ presented: true })
    const read = await tools.readSection(
      ordinanceId,
      electedOfficeId,
      'authority',
    )
    expect(read.authority).toBeNull()
  })
})
