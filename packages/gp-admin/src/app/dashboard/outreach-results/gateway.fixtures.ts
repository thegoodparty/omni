import type {
  OutreachAwaitingResultsResponse,
  OutreachResultsParseReport,
} from '@goodparty_org/contracts'
import { parseResultsCsv } from './lib/parseResultsCsv'
import type { OutreachResultsTarget } from './types'
import type { OutreachResultsGateway } from './gateway'

// Sample data so the page can be opened, clicked through and reviewed before
// B2's endpoints exist. Opt in with OUTREACH_RESULTS_FIXTURES=1 locally; the
// flag is never set in a deployed environment, where the real gateway throws
// and the pages say the endpoints are not built yet.
//
// None of this is a spec for the server. In particular the opt-out test below
// is a placeholder for display only — the single authoritative predicate is
// task A6's, server-side, and is deliberately not duplicated here.

export const fixturesEnabled = (): boolean =>
  process.env.OUTREACH_RESULTS_FIXTURES === '1'

const targets: Record<number, OutreachResultsTarget> = {
  8801: {
    outreachId: 8801,
    name: 'September newsletter text',
    organizationSlug: 'city-of-dover',
    outreachType: 'text',
    recipientCount: 1240,
    sentAt: new Date('2026-09-15T15:00:00Z'),
    expectedBy: new Date('2026-09-18T15:00:00Z'),
    message:
      'Hi from Mayor Reed. We are rebuilding the Elm St crossing this fall. Reply with what you would like fixed next. Reply STOP to opt out.',
    imageUrl: null,
    resultsReceivedAt: null,
  },
  8802: {
    outreachId: 8802,
    name: 'Parks budget question',
    organizationSlug: 'town-of-hadley',
    outreachType: 'poll',
    recipientCount: 480,
    sentAt: new Date('2026-09-17T15:00:00Z'),
    expectedBy: new Date('2026-09-22T15:00:00Z'),
    message:
      'The town has $200k for parks this year. What should it go to? Reply STOP to opt out.',
    imageUrl: null,
    resultsReceivedAt: null,
  },
}

const committed = new Set<number>()

// Stands in for the recipient map: in fixture mode a phone "matches" when its
// last digit is even, which gives a stable mix of matched and unmatched
// without pretending to model anything.
const matchesRecipient = (phone: string): boolean => {
  const digits = phone.replace(/\D/g, '')
  return digits.length > 0 && Number(digits[digits.length - 1]) % 2 === 0
}

const looksLikeOptOut = (content: string): boolean =>
  /^\s*(stop|unsubscribe|quit|end|cancel)\b/i.test(content)

export const fixtureGateway: OutreachResultsGateway = {
  listAwaiting: async (): Promise<OutreachAwaitingResultsResponse> => ({
    items: Object.values(targets)
      .filter((target) => !committed.has(target.outreachId))
      .map((target) => ({
        outreachId: target.outreachId,
        name: target.name,
        organizationSlug: target.organizationSlug,
        outreachType: target.outreachType,
        recipientCount: target.recipientCount,
        sentAt: target.sentAt,
        expectedBy: target.expectedBy,
      })),
  }),

  getTarget: async (outreachId: number): Promise<OutreachResultsTarget> => {
    const target = targets[outreachId]
    if (!target) throw new Error(`No send ${outreachId}`)
    return {
      ...target,
      resultsReceivedAt: committed.has(outreachId) ? new Date() : null,
    }
  },

  upload: async (
    outreachId: number,
    input
  ): Promise<OutreachResultsParseReport> => {
    const parsed = parseResultsCsv(input.csv)
    if (!parsed.ok) throw new Error(parsed.error)

    let matched = 0
    let optOuts = 0
    for (const row of parsed.rows) {
      if (matchesRecipient(row.phone)) matched += 1
      if (looksLikeOptOut(row.content)) optOuts += 1
    }

    if (!input.dryRun) committed.add(outreachId)

    return {
      rowsParsed: parsed.rows.length,
      matched,
      unmatched: parsed.rows.length - matched,
      optOuts,
      committed: !input.dryRun,
    }
  },
}
