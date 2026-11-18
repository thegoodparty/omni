import { randomUUID } from 'node:crypto'
import { Logger } from '@nestjs/common'
import { Client } from 'pg'
import { PinoLogger } from 'nestjs-pino'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CrmCampaignsService } from '@/campaigns/services/crmCampaigns.service'
import { requireEnv } from '@/shared/util/env.util'
import { useTestService } from '@/test-service'
import { dbChangeTriggersSql } from '../../scripts/dbChangeTriggers'
import { dispatchChange } from '@/jobs/changes.registry'
import { DbChangeCleanupService } from './dbChangeCleanup.service'
import { DbChangeHealthService } from './dbChangeHealth.service'
import { DbChangeRelayService } from './dbChangeRelay.service'
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
      data: { hubspotId: 'hubspot-company' },
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

  it('captures nothing a transaction skipped, and records why', async () => {
    await service.prisma.$transaction(async (tx) => {
      await skipChangeEvents(tx, 'test fixture')
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
    expect(
      await service.prisma.$queryRaw`SELECT kind, detail FROM db_change_gap`,
    ).toEqual([{ kind: 'skip', detail: { reason: 'test fixture' } }])
  })

  // A plain SET is not how skipChangeEvents works, but nothing stops someone
  // writing one, and it stays on the connection for as long as that connection
  // lives. Honouring it would stop capture for every later write the connection
  // served, with no error anywhere. One connection here, so the flag is still
  // set when the write runs.
  it('captures a write on a connection with a session-level skip flag', async () => {
    const slug = `change-${randomUUID()}`
    await service.prisma.organization.create({
      data: { slug, ownerId: service.user.id },
    })

    const client = new Client({ connectionString: requireEnv('DATABASE_URL') })
    await client.connect()
    try {
      await client.query(`SET app.skip_change_events = 'on'`)
      await client.query(
        `INSERT INTO campaign (user_id, slug, organization_slug, updated_at)
          VALUES ($1, $2, $2, now())`,
        [service.user.id, slug],
      )
    } finally {
      await client.end()
    }

    expect((await changeRows()).map((row) => row.op)).toEqual(['insert'])
  })

  it('records a gap row when the kill switch flips, both ways', async () => {
    await service.prisma.$executeRaw`
      UPDATE db_change_config SET enabled = false
    `
    await service.prisma.$executeRaw`
      UPDATE db_change_config SET enabled = true
    `

    expect(
      await service.prisma.$queryRaw`SELECT kind, detail FROM db_change_gap
        ORDER BY id`,
    ).toEqual([
      { kind: 'config', detail: { enabled: false, previous: true } },
      { kind: 'config', detail: { enabled: true, previous: false } },
    ])
  })

  // Raw SQL rather than a Prisma update: `campaign.updated_at` is @updatedAt,
  // so any ORM write changes the row and is meant to be captured. This is the
  // statement that writes every column back unchanged.
  it('captures nothing an update changes nothing about', async () => {
    const campaignId = await createCampaign()
    await service.prisma.$executeRaw`DELETE FROM db_change`

    await service.prisma.$executeRaw`
      UPDATE campaign SET slug = slug WHERE id = ${campaignId}
    `

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
      CREATE TRIGGER contact_note_db_change_delete AFTER DELETE ON contact_note
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
      'DROP TRIGGER contact_note_db_change_delete ON contact_note',
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

  // Completing quietly is right — no retry brings a row back — but the handler
  // then never ran, and a pipeline that silently stops handing writes over is
  // the failure this whole thing has no other signal for.
  it('logs an error and completes when the change row is gone', async () => {
    const error = vi.spyOn(Logger.prototype, 'error')
    const handled = vi.fn()

    await dispatchChange(
      {
        model: 'Campaign',
        alertAfterWaitingMinutes: 10,
        onInsert: (row) => {
          handled(row.id)
          return Promise.resolve()
        },
      },
      9_999_999_999n,
      { get: (type) => service.app.get(type) },
    )

    expect(handled).not.toHaveBeenCalled()
    expect(error).toHaveBeenCalledWith(
      expect.objectContaining({ changeId: '9999999999', table: 'campaign' }),
      'change row is gone; nothing to hand the handler',
    )
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

  // A row is kept while a job still names it, whatever that job's state: a
  // handler whose row is gone has nothing to resync from, and a retry or a
  // dead letter can hold a job for days.
  it('keeps a relayed row a queued job still names', async () => {
    // The rows are written here rather than sent, so no worker picks them up
    // while the test reads them: what is under test is the cleanup's predicate
    // on pgboss.job, not pg-boss's queue.
    await createCampaign()
    await service.prisma.$executeRaw`
      UPDATE db_change SET relayed_at = now() - interval '8 days'
    `
    const [change] = await service.prisma.$queryRaw<Array<{ id: bigint }>>`
      SELECT id FROM db_change
    `
    const queueJob = (name: string, state: string) =>
      service.prisma.$executeRawUnsafe(
        `INSERT INTO pgboss.job (id, name, data, state)
          VALUES (gen_random_uuid(), $1,
            jsonb_build_object('changeId', $2), $3::pgboss.job_state)`,
        name,
        change!.id.toString(),
        state,
      )

    for (const state of ['created', 'retry', 'active'] as const) {
      await queueJob('campaignToHubspot', state)
    }
    // A finished job holds nothing: its change is free to go.
    await queueJob('campaignToHubspot', 'completed')

    expect(await service.app.get(DbChangeCleanupService).sweepRelayed()).toBe(0)
    expect(await service.prisma.dbChange.count()).toBe(1)

    await service.prisma.$executeRaw`
      UPDATE pgboss.job SET state = 'completed'
      WHERE name = 'campaignToHubspot'
    `

    expect(await service.app.get(DbChangeCleanupService).sweepRelayed()).toBe(1)
    expect(await service.prisma.dbChange.count()).toBe(0)
  })

  it('deletes a row no job of a change queue names', async () => {
    await createCampaign()
    await service.prisma.$executeRaw`
      UPDATE db_change SET relayed_at = now() - interval '8 days'
    `
    const [change] = await service.prisma.$queryRaw<Array<{ id: bigint }>>`
      SELECT id FROM db_change
    `
    // Some other queue naming the same changeId is somebody else's job, and
    // nothing it does can need this row.
    await service.prisma.$executeRawUnsafe(
      `INSERT INTO pgboss.job (id, name, data)
        VALUES (gen_random_uuid(), 'contactUploadProcess',
          jsonb_build_object('changeId', $1))`,
      change!.id.toString(),
    )

    expect(await service.app.get(DbChangeCleanupService).sweepRelayed()).toBe(1)
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
  it('leaves a campaign with no HubSpot company to the request', async () => {
    const track = vi
      .spyOn(service.app.get(CrmCampaignsService), 'trackCampaign')
      .mockResolvedValue(undefined)
    const slug = `change-${randomUUID()}`
    await service.prisma.organization.create({
      data: { slug, ownerId: service.user.id },
    })
    await service.prisma.campaign.create({
      data: { userId: service.user.id, slug, organizationSlug: slug },
    })

    await relay().relayPass()
    await service.jobs.settle()

    expect(track).not.toHaveBeenCalled()
  })
  it('does not sync HubSpot when only the visit stamp changed', async () => {
    const track = vi
      .spyOn(service.app.get(CrmCampaignsService), 'trackCampaign')
      .mockResolvedValue(undefined)
    const campaignId = await createCampaign()
    await relay().relayPass()
    await service.jobs.settle()
    track.mockClear()

    await service.prisma.$executeRaw`
      UPDATE campaign
      SET data = data || jsonb_build_object('lastVisited', 1),
          updated_at = now()
      WHERE id = ${campaignId}
    `
    await relay().relayPass()
    await service.jobs.settle()
    expect(track).not.toHaveBeenCalled()

    await service.prisma.campaign.update({
      where: { id: campaignId },
      data: { isActive: true },
    })
    await relay().relayPass()
    await service.jobs.settle()
    expect(track).toHaveBeenCalledWith(campaignId)
  })
})

describe('db change health', () => {
  const check = () => service.app.get(DbChangeHealthService).check()
  const error = () =>
    vi.spyOn(
      (
        service.app.get(DbChangeHealthService) as unknown as {
          logger: PinoLogger
        }
      ).logger,
      'error',
    )

  // These tests break a trigger on purpose, and the per-test reset only empties
  // tables, so each starts from the set the migrations installed. Prisma sends
  // one statement per call and the generator's SQL is many, so this is a raw
  // connection.
  beforeEach(async () => {
    const client = new Client({ connectionString: requireEnv('DATABASE_URL') })
    await client.connect()
    try {
      await client.query(dbChangeTriggersSql())
    } finally {
      await client.end()
    }
  })

  it('logs nothing when the pipeline is whole', async () => {
    const logError = error()
    await check()
    expect(logError).not.toHaveBeenCalled()
  })

  it('names the table whose capture trigger is missing', async () => {
    const logError = error()
    await service.prisma.$executeRawUnsafe(
      'DROP TRIGGER campaign_db_change_insert ON campaign',
    )

    await check()

    expect(logError).toHaveBeenCalledWith(
      expect.objectContaining({ table: 'campaign', operation: 'insert' }),
      'db change capture trigger missing, disabled or duplicated',
    )
  })

  it('names the table whose capture trigger is switched off', async () => {
    const logError = error()
    await service.prisma.$executeRawUnsafe(
      'ALTER TABLE campaign DISABLE TRIGGER campaign_db_change_update',
    )

    await check()

    expect(logError).toHaveBeenCalledWith(
      expect.objectContaining({
        table: 'campaign',
        operation: 'update',
        enabledTriggers: 0,
      }),
      'db change capture trigger missing, disabled or duplicated',
    )
  })

  // A trigger nothing reads still costs every write, and a table whose last
  // handler was removed is the way it happens.
  it('names a capture trigger on a table no handler reads', async () => {
    const logError = error()
    await service.prisma.$executeRawUnsafe(`
      CREATE TRIGGER contact_note_db_change_insert AFTER INSERT ON contact_note
      FOR EACH ROW EXECUTE FUNCTION db_change_capture('id')
    `)

    await check()

    expect(logError).toHaveBeenCalledWith(
      { table: 'contact_note', operation: 'insert' },
      'db change capture trigger nothing reads',
    )
  })

  // The registry captures campaign's insert and update only. A delete trigger
  // someone added by hand is captured work no handler will ever read.
  it('names an operation a captured table does not listen to', async () => {
    const logError = error()
    await service.prisma.$executeRawUnsafe(`
      CREATE TRIGGER campaign_db_change_delete AFTER DELETE ON campaign
      FOR EACH ROW EXECUTE FUNCTION db_change_capture('id')
    `)

    await check()

    expect(logError).toHaveBeenCalledWith(
      { table: 'campaign', operation: 'delete' },
      'db change capture trigger nothing reads',
    )
  })

  it('logs when the kill switch is off, and when its row is gone', async () => {
    const logError = error()
    await service.prisma.$executeRaw`
      UPDATE db_change_config SET enabled = false
    `
    await check()
    expect(logError).toHaveBeenCalledWith(
      'db change capture is off: db_change_config row 1 is disabled',
    )

    logError.mockClear()
    await service.prisma.$executeRaw`DELETE FROM db_change_config`
    await check()
    expect(logError).toHaveBeenCalledWith(
      'db change capture is off: db_change_config row 1 is missing',
    )
  })

  it('logs when the relay row is gone', async () => {
    const logError = error()
    await service.prisma.$executeRaw`DELETE FROM db_change_relay`

    await check()

    expect(logError).toHaveBeenCalledWith(
      'db change relay is off: db_change_relay row 1 is missing',
    )
  })

  it('leaves a recent unsent row alone and logs an old one with its age', async () => {
    const logError = error()
    await createCampaign()
    await check()
    expect(logError).not.toHaveBeenCalled()

    await service.prisma.$executeRaw`
      UPDATE db_change SET created_at = now() - interval '6 minutes'
    `
    await check()

    const [detail, message] = logError.mock.calls.find(
      ([, logged]) => logged === 'db change outbox is not draining',
    ) ?? [{}, null]
    expect(message).toBe('db change outbox is not draining')
    expect(detail).toMatchObject({ unsent: 1 })
    expect(
      (detail as { oldestUnsentSeconds: number }).oldestUnsentSeconds,
    ).toBeGreaterThanOrEqual(360)
  })
})
