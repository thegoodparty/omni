import { randomUUID } from 'node:crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CrmCampaignsService } from '@/campaigns/services/crmCampaigns.service'
import { useTestService } from '@/test-service'
import { DbChangeRelayService } from './dbChangeRelay.service'
import { DbChangeCleanupService } from './dbChangeCleanup.service'
import { dispatchChange } from '@/jobs/changes.registry'
import { skipChangeEvents } from './skipChangeEvents'

const service = useTestService({ jobs: true })

const relay = () => service.app.get(DbChangeRelayService)

// The reset empties every public table, and the two seeded rows are in one,
// so each test puts back what production's migration seeded.
beforeEach(async () => {
  await service.prisma
    .$executeRaw`INSERT INTO db_change_config (id, enabled) VALUES (1, true)`
  await service.prisma.$executeRaw`INSERT INTO db_change_relay (id) VALUES (1)`
})

const createCampaign = async (): Promise<number> => {
  const slug = `change-${randomUUID()}`
  await service.prisma.organization.create({
    data: { slug, ownerId: service.user.id },
  })
  const campaign = await service.prisma.campaign.create({
    data: {
      userId: service.user.id,
      slug,
      organizationSlug: slug,
      isActive: false,
    },
  })
  return campaign.id
}

const changeRows = () =>
  service.prisma.$queryRaw<
    Array<{ id: bigint; op: string; row_key: unknown }>
  >`SELECT id, op, row_key FROM db_change ORDER BY id`

const onlyChange = async () => {
  const rows = await changeRows()
  expect(rows).toHaveLength(1)
  return rows[0]!
}

describe('db change relay', () => {
  it('hands an insert and an update to the campaign handler', async () => {
    const track = vi
      .spyOn(service.app.get(CrmCampaignsService), 'trackCampaign')
      .mockResolvedValue(undefined)

    const campaignId = await createCampaign()
    await service.prisma.campaign.update({
      where: { id: campaignId },
      data: { isActive: true },
    })

    expect((await changeRows()).map((row) => row.op)).toEqual([
      'insert',
      'update',
    ])

    await relay().relayPass()
    await service.jobs.settle()

    expect(track).toHaveBeenCalledTimes(2)
    expect(track).toHaveBeenNthCalledWith(1, campaignId)
    expect(track).toHaveBeenNthCalledWith(2, campaignId)
    expect(
      await service.prisma.dbChange.count({ where: { relayedAt: null } }),
    ).toBe(0)
  })

  it('gives the handler the row before and after an update', async () => {
    const previous: Array<{ isActive: boolean }> = []
    const next: Array<{ isActive: boolean }> = []

    const campaignId = await createCampaign()
    await service.prisma.campaign.update({
      where: { id: campaignId },
      data: { isActive: true },
    })
    const [update] = await service.prisma.$queryRaw<Array<{ id: bigint }>>`
      SELECT id FROM db_change WHERE op = 'update'
    `

    await dispatchChange(
      {
        model: 'Campaign',
        alertAfterWaitingMinutes: 10,
        onUpdate: (before, after) => {
          previous.push({ isActive: before.isActive })
          next.push({ isActive: after.isActive })
          return Promise.resolve()
        },
      },
      update!.id,
      { get: (type) => service.app.get(type) },
    )

    expect(previous).toEqual([{ isActive: false }])
    expect(next).toEqual([{ isActive: true }])
  })

  it('captures no delete of a table whose handler listens to none', async () => {
    const campaignId = await createCampaign()
    await service.prisma.$executeRaw`DELETE FROM db_change`

    await service.prisma.campaign.delete({ where: { id: campaignId } })

    expect(await changeRows()).toEqual([])
  })

  it('captures no change of a write that rolled back', async () => {
    await expect(
      service.prisma.$transaction(async (tx) => {
        const slug = `change-${randomUUID()}`
        await tx.organization.create({
          data: { slug, ownerId: service.user.id },
        })
        await tx.campaign.create({
          data: {
            userId: service.user.id,
            slug,
            organizationSlug: slug,
          },
        })
        throw new Error('rolled back')
      }),
    ).rejects.toThrow('rolled back')

    await relay().relayPass()

    expect(await changeRows()).toEqual([])
    expect(await service.prisma.dbChange.count()).toBe(0)
  })

  it('captures nothing while the kill switch is off', async () => {
    await service.prisma
      .$executeRaw`UPDATE db_change_config SET enabled = false`
    await createCampaign()

    expect(await changeRows()).toEqual([])
  })

  it('captures nothing a transaction skipped', async () => {
    await service.prisma.$transaction(async (tx) => {
      await skipChangeEvents(tx)
      const slug = `change-${randomUUID()}`
      await tx.organization.create({
        data: { slug, ownerId: service.user.id },
      })
      await tx.campaign.create({
        data: {
          userId: service.user.id,
          slug,
          organizationSlug: slug,
        },
      })
    })

    expect(await changeRows()).toEqual([])
  })

  it('relays one row’s changes in the order they were captured', async () => {
    const track = vi
      .spyOn(service.app.get(CrmCampaignsService), 'trackCampaign')
      .mockResolvedValue(undefined)
    const handles: Array<{ changeId: bigint }> = []
    const findUnique = service.prisma.dbChange.findUnique.bind(
      service.prisma.dbChange,
    )
    vi.spyOn(service.prisma.dbChange, 'findUnique').mockImplementation((async (
      args: Parameters<typeof findUnique>[0],
      // Prisma's findUnique is generic over its args, which a spy cannot carry.
    ) => {
      const found = await findUnique(args as never)
      if (found) handles.push({ changeId: found.id })
      return found
    }) as typeof findUnique)

    // Repeated because the failure this guards against is a race in pg-boss's
    // fetch ordering, not an answer that is wrong every time: with random job
    // ids, a batch sent in one transaction came out of order in 16 of 20.
    for (let trial = 0; trial < 20; trial++) {
      handles.length = 0
      const campaignId = await createCampaign()
      for (let update = 0; update < 5; update++) {
        await service.prisma.campaign.update({
          where: { id: campaignId },
          data: { isActive: update % 2 === 0 },
        })
      }
      const captured = await service.prisma.$queryRaw<Array<{ id: bigint }>>`
        SELECT id FROM db_change WHERE relayed_at IS NULL ORDER BY id`

      await relay().relayPass()
      await service.jobs.settle()

      expect(handles.map((handle) => handle.changeId)).toEqual(
        captured.map((row) => row.id),
      )
    }
    expect(track).toHaveBeenCalledTimes(20 * 6)
  })

  it('dispatches a delete to a handler that listens to one', async () => {
    const deleted: Array<{ id: string; body: string }> = []
    // The trigger this entry would have, made here: no table production
    // captures has a delete handler yet, and the trigger is what the test is
    // about as much as the dispatch is.
    await service.prisma.$executeRawUnsafe(`
      CREATE TRIGGER contact_note_db_change AFTER DELETE ON contact_note
      FOR EACH ROW EXECUTE FUNCTION db_change_capture('id')
    `)
    const organizationSlug = `change-${randomUUID()}`
    await service.prisma.organization.create({
      data: { slug: organizationSlug, ownerId: service.user.id },
    })
    const note = await service.prisma.contactNote.create({
      data: { organizationSlug, personId: randomUUID(), body: 'note' },
    })
    await service.prisma.contactNote.delete({ where: { id: note.id } })
    await service.prisma.$executeRawUnsafe(
      'DROP TRIGGER contact_note_db_change ON contact_note',
    )

    const change = await onlyChange()
    await dispatchChange(
      {
        model: 'ContactNote',
        alertAfterWaitingMinutes: 10,
        onDelete: (row) => {
          deleted.push({ id: row.id, body: row.body })
          return Promise.resolve()
        },
      },
      change.id,
      { get: (type) => service.app.get(type) },
    )

    expect(change.op).toBe('delete')
    expect(deleted).toEqual([{ id: note.id, body: 'note' }])
  })
})

describe('db change cleanup', () => {
  it('deletes only relayed changes past their retention', async () => {
    const campaignId = await createCampaign()
    await service.prisma.$executeRaw`
      UPDATE db_change SET relayed_at = now() - interval '8 days'
    `
    await service.prisma.campaign.update({
      where: { id: campaignId },
      data: { isActive: true },
    })

    const deleted = await service.app.get(DbChangeCleanupService).sweepRelayed()

    expect(deleted).toBe(1)
    const left = await service.prisma.dbChange.findMany({
      select: { op: true, relayedAt: true },
    })
    expect(left.map((row) => [row.op, row.relayedAt])).toEqual([
      ['update', null],
    ])
  })
  it('relays nothing once another task holds the lease', async () => {
    const track = vi
      .spyOn(service.app.get(CrmCampaignsService), 'trackCampaign')
      .mockResolvedValue(undefined)
    await createCampaign()
    await service.prisma.$executeRaw`
      UPDATE db_change_relay
      SET holder = 'other-task', expires_at = now() + interval '30 seconds'
      WHERE id = 1
    `

    expect(await relay().relayPass()).toBe(0)
    await service.jobs.settle()

    expect(track).not.toHaveBeenCalled()
    expect(
      await service.prisma.dbChange.count({ where: { relayedAt: null } }),
    ).toBe(1)
  })
})
