import { data, type EventRecord } from './data'

export type Product = 'win' | 'serve' | 'shared' | 'untagged'

export const PRODUCT_LABEL: Record<Product, string> = {
  win: 'Win',
  serve: 'Serve',
  shared: 'Shared',
  untagged: 'Product unknown',
}

/**
 * Where the code lives mostly tells you which product an event belongs to, but it
 * cannot settle it. `CreateListWizard.tsx` fires both `Voter Data - List Created`
 * (Win) and `Constituent Data - List Created` (Serve) from the same file, so a shared
 * component branching on product mode defeats any path rule.
 *
 * So the tag is authoritative and the path only fills gaps: a human declaration beats
 * a directory guess, never the other way round. That lifts coverage from 49% to 65%
 * without ever overriding someone's explicit call.
 */
const PATH_RULES: [string, Product][] = [
  ['packages/gp-webapp/app/serve', 'serve'],
  ['packages/gp-webapp/app/polls', 'serve'],
  ['packages/gp-webapp/app/dashboard/polls', 'serve'],
  ['packages/gp-webapp/app/dashboard/briefings', 'serve'],
  ['packages/gp-webapp/app/dashboard/ordinances', 'serve'],
  ['packages/gp-webapp/app/dashboard/community-issues', 'serve'],
  ['packages/gp-webapp/app/dashboard/constituent', 'serve'],
  ['packages/gp-api/src/meetings', 'serve'],
  ['packages/gp-webapp/app/onboarding', 'win'],
  ['packages/gp-webapp/app/dashboard/pro-upgrade', 'win'],
  ['packages/gp-webapp/app/dashboard/profile', 'win'],
  ['packages/gp-webapp/app/dashboard/race-opponent', 'win'],
  ['packages/gp-webapp/app/dashboard/campaign-story', 'win'],
  ['packages/gp-webapp/app/dashboard/campaign-plan', 'win'],
  ['packages/gp-webapp/app/dashboard/campaign-details', 'win'],
  ['packages/gp-webapp/app/dashboard/door-knocking', 'win'],
  ['packages/gp-webapp/app/dashboard/outreach', 'win'],
  ['packages/gp-webapp/app/dashboard/election-result', 'win'],
  ['packages/gp-webapp/app/shared', 'shared'],
  ['packages/gp-webapp/app/dashboard/shared', 'shared'],
  ['packages/gp-webapp/app/dashboard/account', 'shared'],
  ['packages/gp-webapp/app/dashboard/contacts', 'shared'],
  ['packages/gp-webapp/app/sign-up', 'shared'],
]

// A registry or types file is a declaration site, not a call site: it says nothing
// about which product uses the event.
const DECLARATION_FILES = ['helpers/analyticsHelper.ts', 'segment.types.ts']

const productFromPath = (path: string): Product | null => {
  if (!path || DECLARATION_FILES.some((f) => path.includes(f))) return null
  for (const [prefix, product] of PATH_RULES)
    if (path.startsWith(prefix)) return product
  return null
}

export type ProductVerdict = {
  product: Product
  source: 'tag' | 'path' | 'none'
}

export const productVerdictOf = (e: EventRecord): ProductVerdict => {
  const tag = e.tags.find((t) => t.startsWith('product:'))
  if (tag) {
    const value = tag.slice('product:'.length)
    if (value === 'win' || value === 'serve' || value === 'shared') {
      return { product: value, source: 'tag' }
    }
  }
  const fromPath = productFromPath(e.code_path)
  if (fromPath) return { product: fromPath, source: 'path' }
  return { product: 'untagged', source: 'none' }
}

export const productOf = (e: EventRecord): Product =>
  productVerdictOf(e).product

export type Lineage = {
  /** The single event that replaced this one. */
  replacedBy: EventRecord | null
  /** Replaced by a whole family rather than one event (e.g. "Onboarding V2"). */
  replacedByArea: string | null
  /** Named in the prose but resolvable to neither an event nor an area. */
  replacedByName: string | null
  reason: string
  /** Events this one replaced. */
  replaces: EventRecord[]
  /** Recorded supersession prose the parser could not resolve to an event or an area. */
  unparsed: string
  /** Removed, and nothing anywhere claims to have replaced it. */
  deadEnd: boolean
}

// `supersession` is prose, not a reference, and it runs in both directions:
//   "superseded by Voter Data - List Exported (voter file browsing replaced by …)"
//   "supersedes Dashboard - Campaign Plan Viewed"
// so the successor has to be parsed back out. Four of them name a family
// ("Onboarding V2") rather than an event. Worth structuring upstream; until then, this.
const FORWARD = /superseded\s+by\s+([\s\S]+?)(?:\s*\(([\s\S]*)\)\s*)?$/i
const BACKWARD = /^\s*supersedes\s+([\s\S]+?)(?:\s*\(([\s\S]*)\)\s*)?$/i

type Parsed = {
  dir: 'forward' | 'backward' | null
  name: string
  reason: string
}

const parse = (prose: string): Parsed => {
  const back = prose.match(BACKWARD)
  if (back)
    return {
      dir: 'backward',
      name: (back[1] ?? '').trim(),
      reason: (back[2] ?? '').trim(),
    }
  const fwd = prose.match(FORWARD)
  if (fwd)
    return {
      dir: 'forward',
      name: (fwd[1] ?? '').trim(),
      reason: (fwd[2] ?? '').trim(),
    }
  return { dir: null, name: '', reason: prose }
}

const byName = new Map<string, EventRecord>()
for (const e of data.events) {
  byName.set(e.display_name.toLowerCase(), e)
  byName.set(e.event_type.toLowerCase(), e)
}
const areaNames = new Set(data.areas.map((a) => a.name.toLowerCase()))

const resolve = (name: string): EventRecord | null =>
  byName.get(name.toLowerCase()) ?? null
const resolveArea = (name: string): string | null =>
  areaNames.has(name.toLowerCase())
    ? (data.areas.find((a) => a.name.toLowerCase() === name.toLowerCase())
        ?.name ?? null)
    : null

// Both directions feed one index, so a pair that only declares the link on one side
// still renders on both.
const forwardOf = new Map<
  string,
  {
    target: EventRecord | null
    area: string | null
    name: string
    reason: string
  }
>()
const replacesIndex = new Map<string, EventRecord[]>()

const addReplaces = (successor: EventRecord, predecessor: EventRecord) => {
  const list = replacesIndex.get(successor.event_type) ?? []
  if (!list.some((x) => x.event_type === predecessor.event_type))
    list.push(predecessor)
  replacesIndex.set(successor.event_type, list)
}

for (const e of data.events) {
  if (!e.supersession) continue
  const { dir, name, reason } = parse(e.supersession)
  if (!dir || !name) continue
  const hit = resolve(name)
  if (dir === 'forward') {
    forwardOf.set(e.event_type, {
      target: hit,
      area: hit ? null : resolveArea(name),
      name,
      reason,
    })
    if (hit) addReplaces(hit, e)
  } else {
    // "supersedes X": this event is the successor, X is the predecessor.
    if (hit) {
      addReplaces(e, hit)
      if (!forwardOf.has(hit.event_type)) {
        forwardOf.set(hit.event_type, {
          target: e,
          area: null,
          name: e.display_name,
          reason,
        })
      }
    }
  }
}

const REMOVED = new Set(['retired', 'deprecating'])

export const lineageOf = (e: EventRecord): Lineage => {
  const f = forwardOf.get(e.event_type)
  return {
    replacedBy: f?.target ?? null,
    replacedByArea: f?.area ?? null,
    replacedByName: f && !f.target && !f.area ? f.name : null,
    reason: f?.reason ?? '',
    replaces: replacesIndex.get(e.event_type) ?? [],
    // Supersession is prose (DATA-2507) and half of it does not parse. An unparsed
    // note is still a recorded replacement, so show it verbatim rather than claim
    // nothing replaced this — the one reading that sends someone to reinstrument.
    unparsed: !f && e.supersession.trim() ? e.supersession.trim() : '',
    deadEnd: REMOVED.has(e.status) && !f && !e.supersession.trim(),
  }
}

/** The event to actually use today: follow the chain to its end, or this one. */
export const currentVersionOf = (e: EventRecord): EventRecord => {
  let cur = e
  const seen = new Set([e.event_type])
  for (let i = 0; i < 10; i++) {
    const next = lineageOf(cur).replacedBy
    if (!next || seen.has(next.event_type)) break
    seen.add(next.event_type)
    cur = next
  }
  return cur
}
