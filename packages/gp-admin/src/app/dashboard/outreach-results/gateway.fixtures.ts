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

// Keyed by the id string now, because a poll's id is a uuid.
const targets: Record<string, OutreachResultsTarget> = {
  8801: {
    kind: 'sms' as const,
    id: '8801',
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
    kind: 'sms' as const,
    id: '8802',
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

const committed = new Set<string>()

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
      .filter((target) => !committed.has(target.id))
      .map((target) => ({
        kind: target.kind,
        id: target.id,
        name: target.name,
        organizationSlug: target.organizationSlug,
        outreachType: target.outreachType,
        recipientCount: target.recipientCount,
        sentAt: target.sentAt,
        expectedBy: target.expectedBy,
      })),
  }),

  getTarget: async (_kind, id): Promise<OutreachResultsTarget> => {
    const target = targets[id]
    if (!target) throw new Error(`No send ${id}`)
    return {
      ...target,
      resultsReceivedAt: committed.has(id) ? new Date() : null,
    }
  },

  upload: async (_kind, id, input): Promise<OutreachResultsParseReport> => {
    const parsed = parseResultsCsv(input.csv)
    if (!parsed.ok) throw new Error(parsed.error)

    let matched = 0
    let optOuts = 0
    for (const row of parsed.rows) {
      if (matchesRecipient(row.phone)) matched += 1
      if (looksLikeOptOut(row.content)) optOuts += 1
    }

    if (!input.dryRun) committed.add(id)

    return {
      rowsParsed: parsed.rows.length,
      outboundRows: parsed.outboundRows,
      matched,
      unmatched: parsed.rows.length - matched,
      optOuts,
      committed: !input.dryRun,
    }
  },
}
