import { useTestService } from '@/test-service'
import { beforeEach, describe, expect, it } from 'vitest'
import { v7 as uuidv7 } from 'uuid'
import { asSchema } from 'ai'
import {
  MAX_CHECK_RAISES,
  PRIORITY_STATUS_VERSION,
  PRIORITY_STEP_IDS,
  parsePriorityStatus,
  type PriorityStatus,
  type PriorityStep,
  type PriorityStepId,
} from '@goodparty_org/contracts'
import { PrioritySource } from '../../generated/prisma'
import { PriorityStatusService } from './priorityStatus.service'
import { UpdatePriorityStatusInputSchema } from '../schemas/priorityStatus.schema'

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

describe('PriorityStatusService.applyUpdate checks', () => {
  it('records a check on a settled step and keeps it on later patches', async () => {
    const id = await createPriority()
    await statusService.applyUpdate(id, {
      steps: [
        {
          id: 'define',
          state: 'settled',
          summary: 'Rents, not stock',
          check: {
            state: 'asked',
            who: 'Renters near the transit line',
            question: 'Is rent the thing pushing you out?',
          },
        },
      ],
      nextAction: 'Send the check',
    })

    const result = await statusService.applyUpdate(id, {
      steps: [{ id: 'define', state: 'settled', summary: 'Rents mostly' }],
      nextAction: 'Pull the numbers',
    })

    expect(stepOf(result.status, 'define').check).toMatchObject({
      state: 'asked',
      who: 'Renters near the transit line',
      question: 'Is rent the thing pushing you out?',
      raised: 0,
    })
    expect(result.status.version).toBe(PRIORITY_STATUS_VERSION)
    const row = await readRow(id)
    expect(parsePriorityStatus(row.status).steps[0]?.check?.state).toBe('asked')
  })

  it('does not restamp a step when the same check is sent again', async () => {
    const id = await createPriority()
    const patch = {
      steps: [
        {
          id: 'define' as const,
          state: 'settled' as const,
          check: {
            state: 'asked' as const,
            who: 'Renters near the transit line',
            question: 'Is rent the thing pushing you out?',
          },
        },
      ],
      nextAction: 'Send the check',
    }
    const first = await statusService.applyUpdate(id, patch)
    const second = await statusService.applyUpdate(id, patch)

    expect(stepOf(second.status, 'define').updatedAt).toBe(
      stepOf(first.status, 'define').updatedAt,
    )
    expect(stepOf(second.status, 'define').check).toEqual(
      stepOf(first.status, 'define').check,
    )
  })

  it('records the least-affected side on its own', async () => {
    const id = await createPriority()
    await statusService.applyUpdate(id, {
      steps: [
        {
          id: 'define',
          state: 'settled',
          check: {
            state: 'deferred',
            who: 'Renters near the line',
            contrast: { state: 'asked', who: 'Owners across town' },
          },
        },
      ],
      nextAction: 'Open the evidence',
    })

    const result = await statusService.applyUpdate(id, {
      steps: [
        {
          id: 'define',
          state: 'settled',
          check: { contrast: { state: 'out' } },
        },
      ],
      nextAction: 'Open the evidence',
    })

    expect(stepOf(result.status, 'define').check).toMatchObject({
      state: 'deferred',
      raised: 0,
      contrast: { state: 'out', who: 'Owners across town' },
    })
  })

  it('moves the step and drops a malformed check', async () => {
    const id = await createPriority()
    const input = UpdatePriorityStatusInputSchema.parse({
      steps: [
        { id: 'define', state: 'settled', check: { state: 'maybe_later' } },
      ],
      nextAction: 'Open the evidence',
    })

    const result = await statusService.applyUpdate(id, input)

    expect(stepOf(result.status, 'define').state).toBe('settled')
    expect(stepOf(result.status, 'define').check).toBeUndefined()
  })

  it('still advertises check in the tool schema the model is sent', async () => {
    const schema = await asSchema(UpdatePriorityStatusInputSchema).jsonSchema
    expect(JSON.stringify(schema)).toContain('"check"')
    expect(JSON.stringify(schema)).toContain('"deferred"')
  })

  it('counts each deferral recorded over a deferral as a raise', async () => {
    const id = await createPriority()
    const defer = (when?: string) =>
      statusService.applyUpdate(id, {
        steps: [
          {
            id: 'define',
            state: 'settled',
            check: { state: 'deferred', ...(when ? { when } : {}) },
          },
        ],
        nextAction: 'Open the evidence',
      })

    await defer('after the budget hearing')
    await defer()
    const result = await defer()

    expect(stepOf(result.status, 'define').check).toMatchObject({
      state: 'deferred',
      when: 'after the budget hearing',
      raised: 2,
    })
  })
})

describe('update_priority_status holds the check to being offered', () => {
  const toolFor = (id: string, offered: () => boolean) => {
    const tool = statusService.buildStatusTool(
      id,
      offered,
    ).update_priority_status
    if (!tool || !('execute' in tool)) {
      throw new Error('expected an executable update_priority_status tool')
    }
    return tool
  }
  const settleDefine = {
    id: 'define' as const,
    state: 'settled' as const,
    summary: 'Rents, not stock',
  }

  it('says the check is due when a gate settles without one', async () => {
    const id = await createPriority()

    const result = await toolFor(id, () => false).execute({
      steps: [settleDefine],
      nextAction: 'Look at who to ask',
    })

    expect(result).toHaveProperty('checkDue')
    expect(JSON.stringify(result)).toContain('Offer its check now')
    expect(stepOf(await statusService.read(id), 'define').state).toBe('settled')
  })

  it('names every gate settled in one call without a check', async () => {
    const id = await createPriority()

    const result = await toolFor(id, () => false).execute({
      steps: [
        settleDefine,
        { id: 'options', state: 'settled', summary: 'Two paths' },
      ],
      nextAction: 'Ask about both',
    })

    expect(JSON.stringify(result)).toContain('The problem and Your options')
  })

  it('refuses to open the next step past a gate with no check', async () => {
    const id = await createPriority()

    const result = await toolFor(id, () => false).execute({
      steps: [settleDefine, { id: 'evidence', state: 'active' }],
      nextAction: 'Pull the numbers',
    })

    expect(result).toHaveProperty('error')
    expect(stepOf(await statusService.read(id), 'define').state).toBe('open')
  })

  it('refuses to record asked before anything went out', async () => {
    const id = await createPriority()

    const result = await toolFor(id, () => false).execute({
      steps: [{ ...settleDefine, check: { state: 'asked', who: 'Renters' } }],
      nextAction: 'Wait for their answer',
    })

    expect(result).toHaveProperty('error')
    expect(stepOf(await statusService.read(id), 'define').check).toBeUndefined()
  })

  it('records asked once offered, and then the next step opens', async () => {
    const id = await createPriority()
    const tool = toolFor(id, () => true)

    await tool.execute({
      steps: [
        {
          ...settleDefine,
          check: {
            state: 'asked',
            who: 'Renters',
            contrast: { state: 'asked', who: 'Owners across town' },
          },
        },
      ],
      nextAction: 'Wait for their answer',
    })
    const result = await tool.execute({
      steps: [{ id: 'evidence', state: 'active' }],
      nextAction: 'Pull the numbers',
    })

    expect(result).not.toHaveProperty('error')
    const status = await statusService.read(id)
    expect(stepOf(status, 'evidence').state).toBe('active')
    expect(stepOf(status, 'define').check?.contrast?.state).toBe('asked')
  })
})

describe('PriorityStatusService.recordCheckReminder', () => {
  const deferDefine = async () => {
    const id = await createPriority()
    await statusService.applyUpdate(id, {
      steps: [
        {
          id: 'define',
          state: 'settled',
          summary: 'Rents, not stock',
          check: {
            state: 'deferred',
            who: 'Renters near the transit line',
            when: 'after the budget hearing',
          },
        },
        { id: 'evidence', state: 'active' },
      ],
      nextAction: 'Pull the rent numbers',
    })
    const { electedOfficeId } = await service.prisma.priority.findUniqueOrThrow(
      { where: { id }, select: { electedOfficeId: true } },
    )
    return { id, electedOfficeId }
  }

  it('spends the same raise the flow counts, touching nothing else', async () => {
    const { id, electedOfficeId } = await deferDefine()
    const before = await readRow(id)

    const result = await statusService.recordCheckReminder({
      priorityId: id,
      electedOfficeId,
      stepId: 'define',
      answer: 'not_yet',
    })

    expect(result).toMatchObject({ check: { state: 'deferred', raised: 1 } })
    const after = await readRow(id)
    expect(after.currentStep).toBe(before.currentStep)
    expect(after.nextAction).toBe(before.nextAction)
    const define = stepOf(parsePriorityStatus(after.status), 'define')
    expect(define.state).toBe('settled')
    expect(define.summary).toBe('Rents, not stock')
    expect(define.check?.raised).toBe(1)
  })

  it('does not spend a raise when they take it up', async () => {
    const { id, electedOfficeId } = await deferDefine()

    const result = await statusService.recordCheckReminder({
      priorityId: id,
      electedOfficeId,
      stepId: 'define',
      answer: 'taking_it_up',
    })

    expect(result).toMatchObject({ check: { state: 'deferred', raised: 0 } })
  })

  it('records a decline', async () => {
    const { id, electedOfficeId } = await deferDefine()

    const result = await statusService.recordCheckReminder({
      priorityId: id,
      electedOfficeId,
      stepId: 'define',
      answer: 'declined',
    })

    expect(result).toMatchObject({ check: { state: 'declined' } })
  })

  it('refuses once the cap is reached', async () => {
    const { id, electedOfficeId } = await deferDefine()
    const remind = () =>
      statusService.recordCheckReminder({
        priorityId: id,
        electedOfficeId,
        stepId: 'define',
        answer: 'not_yet',
      })
    for (let i = 0; i < MAX_CHECK_RAISES; i += 1) await remind()

    expect(await remind()).toHaveProperty('error')
  })

  it('refuses a step with nothing put off, and another office', async () => {
    const { id, electedOfficeId } = await deferDefine()

    expect(
      await statusService.recordCheckReminder({
        priorityId: id,
        electedOfficeId,
        stepId: 'options',
        answer: 'not_yet',
      }),
    ).toHaveProperty('error')
    expect(
      await statusService.recordCheckReminder({
        priorityId: id,
        electedOfficeId: uuidv7(),
        stepId: 'define',
        answer: 'not_yet',
      }),
    ).toHaveProperty('error')
    const define = stepOf(await statusService.read(id), 'define')
    expect(define.check?.raised).toBe(0)
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
