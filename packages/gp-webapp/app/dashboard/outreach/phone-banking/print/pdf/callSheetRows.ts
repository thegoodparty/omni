import type {
  PhoneBankCallOutcome,
  PhoneBankingInteraction,
  PhoneBankingListEntry,
  PhoneBankingListPerson,
  SupportAnswer,
} from '@goodparty_org/contracts'

// The three-state shape the walk-list PDF uses (`WalkListAnswer` in
// door-knocking's `print/pdf/walkListRows.ts`), reused twice here: once for a
// row's call outcome and once for a person's support answer. `form` prints
// blank tick boxes, `logged` prints a recorded answer as text, and `skip`
// prints an instruction in place of both — there is nothing left to ask.
export type CallSheetAnswer =
  | { kind: 'form' }
  | { kind: 'logged'; label: string }
  | { kind: 'skip'; instruction: string }

export interface CallSheetPerson {
  key: string
  name: string
  support: CallSheetAnswer
}

export interface CallSheetRow {
  key: string
  seq: number
  sheetIndex: number
  phone: string
  persons: CallSheetPerson[]
  outcome: CallSheetAnswer
}

const OUTCOME_LABELS: Record<PhoneBankCallOutcome, string> = {
  answered: 'Answered',
  no_answer: 'No answer',
  voicemail: 'Voicemail',
  wrong_number: 'Wrong number',
  refused: 'Refused',
  disconnected: 'Disconnected',
  hung_up: 'Hung up',
}

// A wrong number, a disconnected line, or a refusal is a dead end: there is
// no household member worth calling back, so the row prints an instruction
// rather than a recorded-but-actionable outcome. `answered` / `no_answer` /
// `voicemail` / `hung_up` are informational — a callback may still be
// worthwhile (hung_up carries no suppression/do-not-call, ENG-10945) — so
// they print as `logged`, not `skip`.
const SKIP_INSTRUCTIONS: Partial<Record<PhoneBankCallOutcome, string>> = {
  wrong_number: 'Wrong number — do not call again',
  refused: 'Refused — do not call again',
  disconnected: 'Disconnected — do not call again',
}

const SUPPORT_LABELS: Record<SupportAnswer, string> = {
  supporter: 'Yes',
  unsure: 'Unsure',
  non_supporter: 'No',
}

// One physical call produces one outcome, so every person on the same entry
// is expected to carry the same interaction. Persons are logged individually
// (the data model allows a household to be reached across separate calls),
// so this takes the first recorded interaction as the row's own — the
// realistic case is that they all agree.
const entryInteraction = (
  entry: PhoneBankingListEntry,
): PhoneBankingInteraction | null =>
  entry.persons.find((person) => person.interaction !== null)?.interaction ??
  null

const outcomeAnswer = (
  interaction: PhoneBankingInteraction | null,
): CallSheetAnswer => {
  if (!interaction) return { kind: 'form' }
  const instruction = SKIP_INSTRUCTIONS[interaction.outcome]
  if (instruction) return { kind: 'skip', instruction }
  return { kind: 'logged', label: OUTCOME_LABELS[interaction.outcome] }
}

// A dead-end call has nobody left to ask, so every person on the row
// inherits the row's own skip instruction rather than a blank Support form.
const supportAnswer = (
  person: PhoneBankingListPerson,
  outcome: CallSheetAnswer,
): CallSheetAnswer => {
  if (outcome.kind === 'skip') return outcome
  if (person.interaction?.supportAnswer) {
    return {
      kind: 'logged',
      label: SUPPORT_LABELS[person.interaction.supportAnswer],
    }
  }
  return { kind: 'form' }
}

// One row per phone number, in seq order. Unlike the walk list's per-resident
// rows, a call reaches one household at once — the row is the call, and its
// named residents stack inside it rather than each getting a row of their own.
export const callSheetRows = (
  entries: PhoneBankingListEntry[],
): CallSheetRow[] =>
  entries
    .slice()
    .sort((a, b) => a.seq - b.seq)
    .map((entry) => {
      const outcome = outcomeAnswer(entryInteraction(entry))
      return {
        key: String(entry.id),
        seq: entry.seq,
        sheetIndex: entry.sheetIndex,
        phone: entry.phone,
        outcome,
        persons: entry.persons.map((person) => ({
          key: person.personId,
          name: person.name,
          support: supportAnswer(person, outcome),
        })),
      }
    })

// The distinct sheet numbers actually present, ascending. Not `list.sheetCount`
// — that field is the build-time cap (sheetCount * 60 entries), and a small
// audience can freeze fewer sheets than it asked for.
export const sheetIndexesOf = (rows: CallSheetRow[]): number[] =>
  [...new Set(rows.map((row) => row.sheetIndex))].sort((a, b) => a - b)

const MM_DD_YYYY = new Intl.DateTimeFormat('en-US', {
  timeZone: 'UTC',
  month: '2-digit',
  day: '2-digit',
  year: 'numeric',
})

// Unlike the printed page's rule (no printed date, because Node's clock is
// UTC and an evening download would stamp tomorrow), the filename's date is
// metadata about the download rather than something a canvasser writes over —
// still formatted in UTC so the same list produces the same filename off any
// machine that builds it.
const filenameDate = (now: Date): string =>
  MM_DD_YYYY.format(now).replace(/\//g, '-')

const slugify = (name: string): string =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .slice(0, 80)
    .replace(/^-+|-+$/g, '')

// `<kebab-list-name>---phone-bank---<MM-DD-YYYY>-list-<N>-of-<M>.pdf`, the
// shipped sample format. Adapted from `walkListFilename`
// (door-knocking's `print/pdf/walkListRows.ts:89`) rather than reused
// directly — that one has no date or sheet segment to carry.
export const callSheetFilename = (
  listName: string,
  sheetIndex: number,
  sheetTotal: number,
  now = new Date(),
): string => {
  const slug = slugify(listName) || 'call-sheet'
  return `${slug}---phone-bank---${filenameDate(now)}-list-${sheetIndex}-of-${sheetTotal}.pdf`
}

// The ZIP that bundles every sheet when a list spans more than one — one name
// per list rather than per sheet, since it holds all of them.
export const callSheetZipFilename = (
  listName: string,
  now = new Date(),
): string => {
  const slug = slugify(listName) || 'call-sheet'
  return `${slug}---phone-bank---${filenameDate(now)}.zip`
}
