import { z } from 'zod'
import { PrismaService } from '@/prisma/prisma.service'
import { CrmCampaignsService } from '@/campaigns/services/crmCampaigns.service'
import {
  MAX_CHANGE_ENTRIES_PER_TABLE,
  type ChangeModel,
  type ChangeOp,
  type ChangeRow,
  type ModelTable,
  changeRow,
  modelTable,
} from '@/dbChanges/dbChangeRows'
import type { JobDefinition, WorkerContext } from '@/jobs/jobs.registry'

// What a handler gets besides the row. The handlers below use method syntax,
// for the reason JobDefinition.worker gives: it makes every entry assignable
// to ChangeEntry<ChangeModel>, which is the type the dispatcher reads.
export type ChangeContext = {
  // The db_change row.
  changeId: bigint
  // Any provider in the app, as in a job's WorkerContext.
  get: WorkerContext['get']
}

// One handler on one table, and so one pg-boss queue, which jobs.registry.ts
// sets up exactly as it sets up a job's. Every captured write of the table
// reaches every entry on it, in the order the entries are listed; one row's
// writes reach each entry in order too.
export type ChangeEntry<M extends ChangeModel = ChangeModel> = {
  model: M
  // Pages someone when a change of this table has waited this long to be
  // handled. Required, as on a job.
  alertAfterWaitingMinutes: number
  timeoutMinutes?: number
  attempts?: number
  concurrency?: number
  maxConcurrent?: number
  // The row from the trigger's to_jsonb(), keyed by Prisma field name
  // (changeRow maps each database column through the model's @map).
  onInsert?(row: ChangeRow<M>, context: ChangeContext): Promise<void>
  onUpdate?(
    previous: ChangeRow<M>,
    next: ChangeRow<M>,
    context: ChangeContext,
  ): Promise<void>
  onDelete?(row: ChangeRow<M>, context: ChangeContext): Promise<void>
}

export const defineChangeHandler = <M extends ChangeModel>(
  entry: ChangeEntry<M>,
): ChangeEntry<M> => entry

// Only campaigns that already have a HubSpot company. Creating the company
// stays with the in-request trackCampaign calls until they are removed: two
// creates racing on a missing hubspotId each make a company.
const syncCampaignToHubspot = async (
  row: ChangeRow<'Campaign'>,
  get: WorkerContext['get'],
): Promise<void> => {
  if (!row.data?.hubspotId) return
  await get(CrmCampaignsService).trackCampaign(row.id)
}

// Every change handler gp-api runs, keyed by the pg-boss queue the relay
// sends each change to. The trigger generator and the relay both read this:
// it is the one place that decides what gets captured. A table appears once
// per entry on it. src/jobs/AGENTS.md § Change handlers.
export const CHANGES = {
  campaignToHubspot: defineChangeHandler({
    model: 'Campaign',
    // The candidate waits on their HubSpot company before outreach setup.
    alertAfterWaitingMinutes: 30,
    // A campaign's HubSpot company follows every insert and every update.
    // Two at a time per task: each is a read, a HubSpot write and an
    // association, and HubSpot answers a burst over its limit with 429s.
    concurrency: 2,
    // Re-reading the campaign makes a retry the same as the next update.
    onInsert: (row, { get }) => syncCampaignToHubspot(row, get),
    onUpdate: (_previous, next, { get }) => syncCampaignToHubspot(next, get),
  }),
}

export type Changes = typeof CHANGES
export type ChangeName = keyof Changes

const isChangeName = (name: string): name is ChangeName => name in CHANGES

export const changeNames = (): ChangeName[] =>
  Object.keys(CHANGES).filter(isChangeName)

export const changeEntry = (name: ChangeName): ChangeEntry => CHANGES[name]

export type ChangeJobData = { changeId: string }

export type TableEntries = {
  table: string
  modelTable: ModelTable
  entries: Array<{ name: ChangeName; index: number }>
}

// Every entry on one table, in the order the relay runs them. An entry's
// place in that order goes into the job id (changeJobId), so the entries
// keep the same order in their queues.
export const tableEntries = (): Map<string, TableEntries> => {
  const byTable = new Map<string, TableEntries>()
  for (const name of changeNames()) {
    const table = modelTable(changeEntry(name).model)
    const found = byTable.get(table.table) ?? {
      table: table.table,
      modelTable: table,
      entries: [],
    }
    // Checked here too, so a table that has outgrown the id's room fails at
    // import rather than on the relay's first batch.
    if (found.entries.length >= MAX_CHANGE_ENTRIES_PER_TABLE) {
      throw new Error(
        `${table.table} has more than ${MAX_CHANGE_ENTRIES_PER_TABLE}`,
      )
    }
    found.entries.push({ name, index: found.entries.length })
    byTable.set(table.table, found)
  }
  return byTable
}

// The tables the triggers capture, with the operations some entry listens
// to. scripts/db-change-triggers.ts writes its migration from this.
export const capturedTables = (): Array<{
  model: ChangeModel
  table: string
  primaryKey: string[]
  operations: ChangeOp[]
}> =>
  [...tableEntries().values()].map(({ table, modelTable, entries }) => {
    const operations: ChangeOp[] = []
    for (const { name } of entries) {
      const entry = changeEntry(name)
      for (const [operation, handler] of [
        ['insert', entry.onInsert],
        ['update', entry.onUpdate],
        ['delete', entry.onDelete],
      ] as const) {
        if (handler && !operations.includes(operation)) {
          operations.push(operation)
        }
      }
    }
    return {
      model: modelTable.model,
      table,
      primaryKey: modelTable.primaryKey,
      operations,
    }
  })

// Hands one captured write to one entry's handler for its operation. A job
// whose change row is gone (the retention sweep deleted it) has nothing to do
// and is completed: no retry brings a row back.
export const dispatchChange = async <M extends ChangeModel>(
  entry: ChangeEntry<M>,
  changeId: bigint,
  { get }: WorkerContext,
): Promise<void> => {
  const change = await get(PrismaService).dbChange.findUnique({
    where: { id: changeId },
  })
  if (!change) return
  const context: ChangeContext = { changeId, get }
  const row = (value: unknown) => changeRow(entry.model, value)
  if (change.op === 'insert' && entry.onInsert) {
    await entry.onInsert(row(change.newRow), context)
  } else if (change.op === 'update' && entry.onUpdate) {
    await entry.onUpdate(row(change.oldRow), row(change.newRow), context)
  } else if (change.op === 'delete' && entry.onDelete) {
    await entry.onDelete(row(change.oldRow), context)
  }
}

export type ChangeJobs = {
  [N in ChangeName]: JobDefinition<ChangeJobData>
}

// defineJob, spelled out here: jobs.registry.ts imports CHANGE_JOBS, so this
// file cannot import anything from it but types.
const defineChangeJob = (
  definition: JobDefinition<ChangeJobData>,
): JobDefinition<ChangeJobData> => definition

// The change queues as jobs, for JOBS in jobs.registry.ts. Every entry in
// CHANGES has one, which is what this builds over.
// eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
export const CHANGE_JOBS = Object.fromEntries(
  changeNames().map((name) => {
    const entry: ChangeEntry = CHANGES[name]
    return [
      name,
      defineChangeJob({
        schema: z.object({ changeId: z.string().regex(/^\d+$/) }),
        worker: (job, context) =>
          dispatchChange(changeEntry(name), BigInt(job.data.changeId), context),
        alertAfterWaitingMinutes: entry.alertAfterWaitingMinutes,
        timeoutMinutes: entry.timeoutMinutes,
        attempts: entry.attempts,
        concurrency: entry.concurrency,
        maxConcurrent: entry.maxConcurrent,
      }),
    ]
  }),
) as ChangeJobs
