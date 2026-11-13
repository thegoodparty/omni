import { Inject, Injectable } from '@nestjs/common'
import type { DatabricksProvider } from '@/llm/tools/queryDatabricks.tool'
import { SERVE_AGENT_VOTER_DIMENSIONS } from '@/chats/general/chief-of-staff/services/constituentDimensions.serveAgentVoters'
import { MEETING_BRIEFING_SENTIMENT_COLUMNS } from './sentimentColumns'

export const BRIEFING_CONSTITUENT_DATA = Symbol('BRIEFING_CONSTITUENT_DATA')

const TABLE = 'goodparty_data_catalog.mart_serve_agents.serve_agent_voters'
// Same floor the Chief of Staff's constituent tool applies to every cell.
export const MIN_CONSTITUENTS = 100
const MAX_DISTRICT_VALUES = 500

const SENTIMENT_COLUMNS = new Set<string>(MEETING_BRIEFING_SENTIMENT_COLUMNS)
const DISTRICT_COLUMNS = new Set(
  SERVE_AGENT_VOTER_DIMENSIONS.filter((column) =>
    /^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(column),
  ),
)

export type SentimentRequest = {
  state: string
  columns: string[]
  district?: { type: string; name: string }
}

export type SentimentResult = {
  scope: 'district' | 'state'
  districtResolved: boolean
  districtValue: string | null
  constituentCount: number
  meanScores: Record<string, number | null>
  suppressed: boolean
  query: string
}

const literal = (value: string): string =>
  `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`

const toNumber = (value: unknown): number | null => {
  if (value === null || value === undefined || value === '') return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

@Injectable()
export class ConstituentSentimentService {
  constructor(
    @Inject(BRIEFING_CONSTITUENT_DATA)
    private readonly data: DatabricksProvider | null,
  ) {}

  async meanScores(request: SentimentRequest): Promise<SentimentResult> {
    const data = this.data
    if (!data) {
      throw new Error('ConstituentDataUnavailable')
    }
    if (!/^[A-Z]{2}$/.test(request.state)) {
      throw new Error(`state must be a two-letter code, got ${request.state}`)
    }
    const columns = [...new Set(request.columns)]
    const unknown = columns.filter((column) => !SENTIMENT_COLUMNS.has(column))
    if (columns.length === 0 || unknown.length > 0) {
      throw new Error(
        `columns must be non-empty and from the briefing catalog; not in it: ${unknown.join(', ')}`,
      )
    }
    const base = `Residence_Addresses_State = ${literal(request.state)} AND Voters_Active = 'A'`

    const districtValue = request.district
      ? await this.resolveDistrict(data, base, request.district)
      : null
    const where =
      districtValue !== null && request.district
        ? `${base} AND \`${request.district.type}\` = ${literal(districtValue)}`
        : base
    const query =
      `SELECT ${columns
        .map(
          (column) =>
            `ROUND(AVG(CAST(\`${column}\` AS DOUBLE)), 1) AS \`${column}\``,
        )
        .join(', ')}, COUNT(*) AS constituent_count ` +
      `FROM ${TABLE} WHERE ${where}`
    const { rows } = await data.query(query)
    const row = rows[0] ?? {}
    const constituentCount = toNumber(row.constituent_count) ?? 0
    const suppressed = constituentCount < MIN_CONSTITUENTS
    return {
      scope: districtValue !== null ? 'district' : 'state',
      districtResolved: districtValue !== null,
      districtValue,
      constituentCount,
      meanScores: Object.fromEntries(
        columns.map((column) => [
          column,
          suppressed ? null : toNumber(row[column]),
        ]),
      ),
      suppressed,
      query,
    }
  }

  private async resolveDistrict(
    data: DatabricksProvider,
    base: string,
    district: { type: string; name: string },
  ): Promise<string | null> {
    if (!DISTRICT_COLUMNS.has(district.type)) return null
    const { rows } = await data.query(
      `SELECT \`${district.type}\` AS district_value, COUNT(*) AS n ` +
        `FROM ${TABLE} WHERE ${base} AND \`${district.type}\` IS NOT NULL ` +
        `GROUP BY \`${district.type}\` ORDER BY n DESC LIMIT ${MAX_DISTRICT_VALUES}`,
    )
    const values = rows
      .map((row) => row.district_value)
      .filter((value): value is string => typeof value === 'string')
    const wanted = district.name.trim().toLowerCase()
    return (
      values.find((value) => value === district.name) ??
      values.find((value) => value.toLowerCase() === wanted) ??
      values.find((value) => value.toLowerCase().includes(wanted)) ??
      null
    )
  }
}
