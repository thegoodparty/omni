import { beforeEach, describe, expect, it } from 'vitest'
import { NotFoundException } from '@nestjs/common'
import { useTestService } from '@/test-service'
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
  return { electedOfficeId: electedOffice.id, ordinanceId: ordinance.id }
}

describe('OrdinanceFlowToolsService', () => {
  let tools: OrdinanceFlowToolsService
  let ordinanceId: string
  let electedOfficeId: string

  beforeEach(async () => {
    tools = service.app.get(OrdinanceFlowToolsService)
    ;({ ordinanceId, electedOfficeId } = await seedOrdinance(service.user.id))
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

  it('returns a labeled stub for current code until the loader is wired', async () => {
    const code = await tools.getCurrentCode(
      ordinanceId,
      electedOfficeId,
      'Chapter 9.16',
    )
    expect(code.stub).toBe(true)
    expect(code.chapterLabel).toBe('Chapter 9.16')
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
