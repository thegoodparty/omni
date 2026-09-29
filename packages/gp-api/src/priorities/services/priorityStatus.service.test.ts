import { useTestService } from '@/test-service'
import { beforeEach, describe, expect, it } from 'vitest'
import { v7 as uuidv7 } from 'uuid'
import {
  PRIORITY_STEP_IDS,
  type PriorityStatus,
  type PriorityStep,
  type PriorityStepId,
} from '@goodparty_org/contracts'
import { PrioritySource } from '../../generated/prisma'
import { PriorityStatusService } from './priorityStatus.service'

const service = useTestService()

let statusService: PriorityStatusService

const createPriority = async () => {
  const officeId = uuidv7()
  const slug = `eo-${officeId}`
  await service.prisma.organization.create({
    data: { slug, ownerId: service.user.id },
  })
  await service.prisma.electedOffice.create({
    data: { id: officeId, userId: service.user.id, organizationSlug: slug },
  })
  const priority = await service.prisma.priority.create({
    data: {
      electedOfficeId: officeId,
      title: 'Affordable housing',
      description: 'Build more units near transit',
      source: PrioritySource.user_stated,
    },
  })
  return priority.id
}

const readRow = (id: string) =>
  service.prisma.priority.findUniqueOrThrow({
    where: { id },
    select: { status: true, currentStep: true, nextAction: true },
  })

const stepOf = (status: PriorityStatus, id: PriorityStepId): PriorityStep => {
  const step = status.steps.find((candidate) => candidate.id === id)
  if (!step) throw new Error(`missing step ${id}`)
  return step
}

beforeEach(() => {
  statusService = service.app.get(PriorityStatusService)
})

describe('PriorityStatusService.read', () => {
  it('reads a fresh priority as all seven steps open', async () => {
    const id = await createPriority()

    const status = await statusService.read(id)

    expect(status.steps.map((step) => step.id)).toEqual([...PRIORITY_STEP_IDS])
    expect(status.steps.every((step) => step.state === 'open')).toBe(true)
    expect(status.steps.every((step) => step.summary === '')).toBe(true)
  })

  it('reads a garbage status blob as empty rather than throwing', async () => {
    const id = await createPriority()
    await service.prisma.priority.update({
      where: { id },
      data: { status: { steps: 'not an array', wat: 3 } },
    })

    const status = await statusService.read(id)

    expect(status.steps).toHaveLength(PRIORITY_STEP_IDS.length)
    expect(status.steps.every((step) => step.state === 'open')).toBe(true)
  })
})

describe('PriorityStatusService.applyUpdate', () => {
  it('settling a step moves currentStep to the next one', async () => {
    const id = await createPriority()

    const result = await statusService.applyUpdate(id, {
      steps: [{ id: 'define', state: 'settled', summary: 'Rents, not stock' }],
      nextAction: 'Pull the rent-burden numbers',
    })

    expect(result.currentStep).toBe('evidence')
    expect(result.nextAction).toBe('Pull the rent-burden numbers')
    expect(stepOf(result.status, 'define').state).toBe('settled')

    const row = await readRow(id)
    expect(row.currentStep).toBe('evidence')
    expect(row.nextAction).toBe('Pull the rent-burden numbers')
  })

  it('an active step wins over earlier open and stale steps', async () => {
    const id = await createPriority()

    const result = await statusService.applyUpdate(id, {
      steps: [
        { id: 'define', state: 'stale', caveat: 'Council redefined it' },
        { id: 'options', state: 'active' },
      ],
      nextAction: 'Pick between the two ordinances',
    })

    expect(result.currentStep).toBe('options')
  })

  it('leaves a step it was not told about exactly as it was', async () => {
    const id = await createPriority()
    await statusService.applyUpdate(id, {
      steps: [{ id: 'define', state: 'settled', summary: 'Rents, not stock' }],
      nextAction: 'Pull the numbers',
    })

    const result = await statusService.applyUpdate(id, {
      steps: [{ id: 'evidence', state: 'active' }],
      nextAction: 'Read the housing report',
    })

    const define = result.status.steps.find((step) => step.id === 'define')
    expect(define).toMatchObject({
      state: 'settled',
      summary: 'Rents, not stock',
    })
  })

  it('omitting summary preserves the stored summary', async () => {
    const id = await createPriority()
    await statusService.applyUpdate(id, {
      steps: [{ id: 'define', state: 'settled', summary: 'Rents, not stock' }],
      nextAction: 'Pull the numbers',
    })

    const result = await statusService.applyUpdate(id, {
      steps: [{ id: 'define', state: 'stale', caveat: 'New census data' }],
      nextAction: 'Re-read the definition with the official',
    })

    const define = result.status.steps.find((step) => step.id === 'define')
    expect(define).toMatchObject({
      state: 'stale',
      summary: 'Rents, not stock',
      caveat: 'New census data',
    })
  })

  it('an empty caveat clears it while an omitted one keeps it', async () => {
    const id = await createPriority()
    await statusService.applyUpdate(id, {
      steps: [{ id: 'define', state: 'stale', caveat: 'New census data' }],
      nextAction: 'Re-check',
    })

    const kept = await statusService.applyUpdate(id, {
      steps: [{ id: 'define', state: 'active' }],
      nextAction: 'Re-check',
    })
    expect(stepOf(kept.status, 'define').caveat).toBe('New census data')

    const cleared = await statusService.applyUpdate(id, {
      steps: [{ id: 'define', state: 'settled', caveat: '' }],
      nextAction: 'Move on to evidence',
    })
    expect(stepOf(cleared.status, 'define').caveat).toBeUndefined()
  })

  it('moves a settled step back to active and currentStep backwards', async () => {
    const id = await createPriority()
    await statusService.applyUpdate(id, {
      steps: [
        { id: 'define', state: 'settled', summary: 'Rents, not stock' },
        { id: 'evidence', state: 'settled', summary: '41% rent burdened' },
        { id: 'listen_problem', state: 'active' },
      ],
      nextAction: 'Book the tenants-union call',
    })

    const result = await statusService.applyUpdate(id, {
      steps: [{ id: 'define', state: 'active' }],
      nextAction: 'Redefine the problem with the new council scope',
    })

    expect(result.currentStep).toBe('define')
    expect(stepOf(result.status, 'define').state).toBe('active')
    expect(stepOf(result.status, 'evidence').state).toBe('settled')

    const row = await readRow(id)
    expect(row.currentStep).toBe('define')
  })

  it('opening a step demotes the step that was active', async () => {
    const id = await createPriority()
    await statusService.applyUpdate(id, {
      steps: [
        { id: 'evidence', state: 'active', summary: 'Half the blocks so far' },
      ],
      nextAction: 'Pull the repair backlog',
    })

    const result = await statusService.applyUpdate(id, {
      steps: [{ id: 'options', state: 'active' }],
      nextAction: 'Price the two repair programs',
    })

    expect(stepOf(result.status, 'evidence').state).toBe('open')
    expect(stepOf(result.status, 'evidence').summary).toBe(
      'Half the blocks so far',
    )
    expect(stepOf(result.status, 'options').state).toBe('active')
    expect(result.currentStep).toBe('options')
  })

  it('keeps the last active step when one call sets two', async () => {
    const id = await createPriority()

    const result = await statusService.applyUpdate(id, {
      steps: [
        { id: 'define', state: 'active' },
        { id: 'evidence', state: 'active' },
      ],
      nextAction: 'Pull the rent-burden numbers',
    })

    expect(stepOf(result.status, 'define').state).toBe('open')
    expect(stepOf(result.status, 'evidence').state).toBe('active')
    expect(result.currentStep).toBe('evidence')
  })

  it('leaves the active step alone when a call opens no new one', async () => {
    const id = await createPriority()
    await statusService.applyUpdate(id, {
      steps: [{ id: 'evidence', state: 'active' }],
      nextAction: 'Pull the repair backlog',
    })

    const result = await statusService.applyUpdate(id, {
      steps: [{ id: 'define', state: 'settled', summary: 'Rents, not stock' }],
      nextAction: 'Pull the repair backlog',
    })

    expect(stepOf(result.status, 'evidence').state).toBe('active')
    expect(result.currentStep).toBe('evidence')
  })

  it('going back leaves the other settled steps settled', async () => {
    const id = await createPriority()
    await statusService.applyUpdate(id, {
      steps: [
        { id: 'define', state: 'settled', summary: 'Rents, not stock' },
        { id: 'evidence', state: 'settled', summary: '41% rent burdened' },
        { id: 'listen_problem', state: 'active' },
      ],
      nextAction: 'Book the tenants-union call',
    })

    const result = await statusService.applyUpdate(id, {
      steps: [{ id: 'define', state: 'active', caveat: 'Council cut scope' }],
      nextAction: 'Redefine the problem against the new council scope',
    })

    expect(stepOf(result.status, 'define')).toMatchObject({
      state: 'active',
      summary: 'Rents, not stock',
      caveat: 'Council cut scope',
    })
    expect(stepOf(result.status, 'evidence').state).toBe('settled')
    expect(stepOf(result.status, 'listen_problem').state).toBe('open')
    expect(result.currentStep).toBe('define')
  })

  it('leaves currentStep null when every step is settled', async () => {
    const id = await createPriority()

    const result = await statusService.applyUpdate(id, {
      steps: PRIORITY_STEP_IDS.map((stepId) => ({
        id: stepId,
        state: 'settled' as const,
        summary: `${stepId} done`,
      })),
      nextAction: '',
    })

    expect(result.currentStep).toBeNull()
    expect(result.nextAction).toBeNull()

    const row = await readRow(id)
    expect(row.currentStep).toBeNull()
    expect(row.nextAction).toBeNull()
  })

  it('stamps updatedAt only on the steps the call changed', async () => {
    const id = await createPriority()
    await statusService.applyUpdate(id, {
      steps: [{ id: 'define', state: 'settled', summary: 'Rents, not stock' }],
      nextAction: 'Pull the numbers',
    })
    const first = await statusService.read(id)
    const definedAt = stepOf(first, 'define').updatedAt

    const result = await statusService.applyUpdate(id, {
      steps: [
        { id: 'define', state: 'settled', summary: 'Rents, not stock' },
        { id: 'evidence', state: 'active' },
      ],
      nextAction: 'Read the housing report',
    })

    expect(stepOf(result.status, 'define').updatedAt).toBe(definedAt)
    expect(stepOf(result.status, 'evidence').updatedAt).toBeDefined()
    expect(stepOf(result.status, 'options').updatedAt).toBeUndefined()
  })
})

describe('PriorityStatusService.buildStatusTool', () => {
  it('exposes update_priority_status and writes through it', async () => {
    const id = await createPriority()

    const tool = statusService.buildStatusTool(id).update_priority_status
    if (!tool || !('execute' in tool)) {
      throw new Error('expected an executable update_priority_status tool')
    }

    await tool.execute({
      steps: [{ id: 'define', state: 'active' }],
      nextAction: '  Name the problem in one sentence  ',
    })

    const row = await readRow(id)
    expect(row.currentStep).toBe('define')
    expect(row.nextAction).toBe('Name the problem in one sentence')
  })
})
