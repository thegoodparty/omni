import { Prisma } from '@/generated/prisma'

export type ChangeModel = Prisma.ModelName
export type ChangeOp = 'insert' | 'update' | 'delete'
export type ChangeRow<M extends ChangeModel> =
  Prisma.TypeMap['model'][M]['payload']['scalars']

export type ModelTable = {
  model: ChangeModel
  // The table the entry's trigger fires on.
  table: string
  // The columns the trigger names in db_change.row_key, in declaration order.
  primaryKey: string[]
  // Scalar columns of the row, by Prisma field name.
  columns: Array<{ name: string; dbName: string; type: string }>
}

const DMMF_MODELS = new Map(
  Prisma.dmmf.datamodel.models.map((model) => [model.name, model]),
)

// DMMF, not the datamodel files: the trigger writes the database's column
// names and a handler reads Prisma's field names, and DMMF is what has both.
const MODEL_TABLES = new Map<ChangeModel, ModelTable>(
  Object.values(Prisma.ModelName).flatMap((model) => {
    const fields = DMMF_MODELS.get(model)?.fields
    if (!fields) return []
    return [
      [
        model,
        {
          model,
          table: DMMF_MODELS.get(model)?.dbName ?? model,
          primaryKey: fields
            .filter((field) => field.isId)
            .map((field) => field.dbName ?? field.name),
          columns: fields
            .filter((field) => field.kind === 'scalar' || field.kind === 'enum')
            .map((field) => ({
              name: field.name,
              dbName: field.dbName ?? field.name,
              type: field.type,
            })),
        },
      ],
    ]
  }),
)

export const modelTable = <M extends ChangeModel>(model: M): ModelTable => {
  const found = MODEL_TABLES.get(model)
  if (!found) throw new Error(`No Prisma model named ${model}`)
  return found
}

// JSONB carries what the database stores, which for these three types is not
// what Prisma's types say: a timestamp is a string, a decimal and a bigint
// are numbers.
const coerce = (type: string, value: unknown): unknown => {
  if (typeof value !== 'string' && typeof value !== 'number') return value
  if (type === 'DateTime') return new Date(value)
  if (type === 'Decimal') return new Prisma.Decimal(value)
  if (type === 'BigInt') return BigInt(value)
  return value
}

// What the trigger wrote with to_jsonb() arrives as JSONB, which Prisma types
// as unknown on a JSON column.
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

// One stored row as the handler's typed row: database column names to Prisma
// field names, and a timestamp or a decimal back to its class.
export const changeRow = <M extends ChangeModel>(
  model: M,
  row: unknown,
): ChangeRow<M> => {
  const mapped: Record<string, unknown> = {}
  if (isRecord(row)) {
    for (const column of modelTable(model).columns) {
      if (!(column.dbName in row)) continue
      mapped[column.name] = coerce(column.type, row[column.dbName])
    }
  }
  // The keys are the model's scalar columns and the values come from the
  // database, so this is the model's row shape by construction; the type it
  // is narrowed from is the generic Record built above.
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
  return mapped as ChangeRow<M>
}

// The entry indexes changeJobId can carry.
export const MAX_CHANGE_ENTRIES_PER_TABLE = 0xff

// A uuid whose lexical order is (changeId, entryIndex): the change id in 16
// hex digits, then the entry's place in its table's order, laid across the
// groups the uuid's fixed version and variant nibbles leave free.
//
// Jobs relayed in one transaction all get pgboss.job's created_on from that
// transaction's now(), so they tie, and pg-boss breaks the tie on the id. A
// random uuid put one row's changes out of order 16 times in 20. A fixed id
// also makes a resend of the same change insert nothing.
export const changeJobId = (changeId: bigint, entryIndex: number): string => {
  if (entryIndex > MAX_CHANGE_ENTRIES_PER_TABLE) {
    throw new Error(`${entryIndex} change handlers on one table is too many`)
  }
  const key = `${changeId.toString(16).padStart(16, '0').slice(-16)}${entryIndex
    .toString(16)
    .padStart(2, '0')}`
  return [
    key.slice(0, 8),
    key.slice(8, 12),
    `4${key.slice(12, 15)}`,
    `8${key.slice(15, 18)}`,
    '000000000000',
  ].join('-')
}

// The relay's pg-boss group for one row's changes: one row's changes run one
// at a time, in the order they were captured. jsonb comes back with its keys
// in PostgreSQL's own order, so the same row always gives the same group.
export const changeGroup = (table: string, rowKey: unknown): string =>
  `${table}:${JSON.stringify(rowKey)}`
