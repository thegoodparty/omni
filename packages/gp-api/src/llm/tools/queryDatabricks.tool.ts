export interface DatabricksRowSet {
  columns: string[]
  rows: Array<Record<string, unknown>>
}

export interface DatabricksProvider {
  query: (sql: string) => Promise<DatabricksRowSet>
}

const normalizeSql = (sql: string): string =>
  sql.toLowerCase().replace(/\s+/g, ' ').trim()

export class InMemoryDatabricksProvider implements DatabricksProvider {
  constructor(private readonly responses: Map<string, DatabricksRowSet>) {}

  query(sql: string): Promise<DatabricksRowSet> {
    const hit = this.responses.get(normalizeSql(sql))
    if (!hit) {
      return Promise.resolve({ columns: [], rows: [] })
    }
    return Promise.resolve(hit)
  }
}
