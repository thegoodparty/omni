import { ModuleRef } from '@nestjs/core'
import { describe, expect, it } from 'vitest'
import { loadAgentPrompt } from '@/agents/agentPrompt'
import { AGENTS } from '@/agents/agents.registry'
import { useTestService } from '@/test-service'
import { MeetingBriefingSchema } from './meetingBriefing.schema'
import { fullBriefing, placeholder } from './meetingBriefingArtifact.fixture'

const service = useTestService()

const RUNTIME_LEFTOVERS = [
  'pmf_runtime',
  'PARAMS_FILE',
  '/workspace',
  'milestone(',
  'TodoWrite',
  'http.get',
  'pdf.download',
  'broker',
]

const seedOffice = async (organizationSlug: string) => {
  await service.prisma.organization.create({
    data: { slug: organizationSlug, ownerId: service.user.id },
  })
  return service.prisma.electedOffice.create({
    data: { organizationSlug, userId: service.user.id },
  })
}

const runInput = (organizationSlug: string, electedOfficeId: string) => ({
  organizationSlug,
  electedOfficeId,
  requestedAt: '2026-05-14T12:00:00Z',
  officialName: 'Rowan Ledbetter',
  state: 'NC',
  meetingDate: '2026-05-19',
})

describe('meetingBriefing definition', () => {
  it('has a prompt that names its tools and no Fargate runtime', () => {
    const prompt = loadAgentPrompt(AGENTS.meetingBriefing.prompt)
    for (const tool of AGENTS.meetingBriefing.tools) {
      expect(prompt).toContain(tool.name)
    }
    for (const leftover of RUNTIME_LEFTOVERS) {
      expect(prompt).not.toContain(leftover)
    }
  })

  it('ends on the briefing artifact', () => {
    expect(AGENTS.meetingBriefing.output).toBe(MeetingBriefingSchema)
  })
})

describe('meetingBriefing onArtifact', () => {
  it('saves the artifact on the briefing row, which the briefing route then serves', async () => {
    const office = await seedOffice('eo-agent-briefing')
    await AGENTS.meetingBriefing.onArtifact(
      fullBriefing,
      { runId: 'run-1', input: runInput('eo-agent-briefing', office.id) },
      service.app.get(ModuleRef),
    )

    const row = await service.prisma.meetingBriefing.findFirstOrThrow({
      where: { electedOfficeId: office.id },
    })
    expect(row).toMatchObject({
      meetingTime: '17:45',
      meetingTimezone: 'America/New_York',
      experimentRunId: null,
      artifactBucket: null,
      artifactKey: null,
    })

    const result = await service.client.get(
      '/v1/meetings/2026-05-19/briefing',
      { headers: { 'x-organization-slug': 'eo-agent-briefing' } },
    )
    expect(result.status).toBe(200)
    expect(result.data).toMatchObject({
      briefing_status: 'briefing_ready',
      official_name: 'Rowan Ledbetter',
      briefing_id: row.id,
    })
  })

  it('writes no row for a placeholder, but keeps the agenda location hint', async () => {
    const office = await seedOffice('eo-agent-placeholder')
    await AGENTS.meetingBriefing.onArtifact(
      placeholder,
      { runId: 'run-2', input: runInput('eo-agent-placeholder', office.id) },
      service.app.get(ModuleRef),
    )

    expect(
      await service.prisma.meetingBriefing.count({
        where: { electedOfficeId: office.id },
      }),
    ).toBe(0)
    expect(
      await service.prisma.meetingResourceLocation.findFirst({
        where: { electedOfficeId: office.id },
      }),
    ).toMatchObject({ description: 'https://example.gov/agendas' })
  })

  it('refuses an artifact that fails the output schema', async () => {
    const office = await seedOffice('eo-agent-invalid')
    await expect(
      AGENTS.meetingBriefing.onArtifact(
        { ...fullBriefing, disclosure: '' },
        { runId: 'run-3', input: runInput('eo-agent-invalid', office.id) },
        service.app.get(ModuleRef),
      ),
    ).rejects.toThrow()
  })
})
