import { ManagedPanelWaveJobService } from '@/managedPanelWaves/managedPanelWaveJob.service'
import { OrganizationsService } from '@/organizations/services/organizations.service'
import { PriorityAnswerCodingService } from '@/priorities/services/priorityAnswerCoding.service'
import { useTestService } from '@/test-service'
import { randomUUID } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import {
  OutreachStatus,
  OutreachType,
  PrioritySource,
} from '../../generated/prisma'
import { TestModeCivicPanelService } from '../services/testModeCivicPanel.service'

const service = useTestService({ jobs: true })

const createOffice = async (testMode: boolean) => {
  const id = randomUUID()
  const slug = OrganizationsService.electedOfficeOrgSlug(id)
  await service.prisma.organization.create({
    data: {
      slug,
      ownerId: service.user.id,
      testModeCreatedAt: testMode ? new Date() : null,
    },
  })
  return service.prisma.electedOffice.create({
    data: { id, organizationSlug: slug, userId: service.user.id },
  })
}

const applyPreset = async (
  preset: Parameters<TestModeCivicPanelService['apply']>[2],
) => {
  const office = await createOffice(true)
  await service.app
    .get(TestModeCivicPanelService)
    .apply(office, service.user.id, preset)
  return office
}

describe('Test mode civic panel and background jobs', () => {
  it('fans out waves for an ordinary panel and never a test one', async () => {
    vi.stubEnv('OTEL_SERVICE_ENVIRONMENT', 'dev')
    await applyPreset('halfway')
    const office = await createOffice(false)
    const panel = await service.prisma.managedCivicPanel.create({
      data: {
        organizationSlug: office.organizationSlug,
        inviteMessage: 'Reply JOIN to share your perspectives.',
        consentVersion: 'test',
        approvedAt: new Date(),
        goalMembers: 250,
      },
    })
    const advance = vi
      .spyOn(service.app.get(ManagedPanelWaveJobService), 'advanceWave')
      .mockResolvedValue()

    await service.jobs.runSchedule('managedPanelWaves')

    expect(advance.mock.calls.map(([job]) => job.data)).toEqual([
      { enrollmentId: panel.id },
    ])
  })

  it('codes an ordinary priority send and never a test one', async () => {
    await applyPreset('answers_in')
    const office = await createOffice(false)
    const priority = await service.prisma.priority.create({
      data: {
        electedOfficeId: office.id,
        title: 'Parks',
        description: 'More parks',
        source: PrioritySource.user_stated,
      },
    })
    const outreach = await service.prisma.outreach.create({
      data: {
        organizationSlug: office.organizationSlug,
        campaignId: null,
        outreachType: OutreachType.text,
        status: OutreachStatus.completed,
        message: 'Do we need more parks?',
        priorityId: priority.id,
      },
    })
    const code = vi
      .spyOn(service.app.get(PriorityAnswerCodingService), 'codeScheduled')
      .mockResolvedValue()

    await service.jobs.runSchedule('priorityAnswerCodingSweep')

    expect(code.mock.calls.map(([job]) => job.data)).toEqual([
      { outreachId: outreach.id },
    ])
  })
})
