import { loadOrdinanceFixture } from './stepEntry'

// Labeled QC drafts: the real bike-parking draft plus three deliberately broken
// mutations of it. Each names the six-check rubric ids the grader should react
// to, so the QC eval can measure whether the grader (the quality loop's
// objective function) catches an injected defect the clean draft does not have.
export interface QcDraft {
  name: string
  draftBody: string
  expectFlaggedCheckIds: string[]
}

const baseDraft = (): string => {
  const body = loadOrdinanceFixture('bike-parking').draftBody
  if (body === null || body.length === 0) {
    throw new Error('bike-parking fixture is missing a draftBody')
  }
  return body
}

const BASE_DRAFT = baseDraft()

const replaceOnce = (source: string, find: string, next: string): string => {
  const at = source.indexOf(find)
  if (at === -1) {
    throw new Error(`QC draft mutation anchor not found: ${find}`)
  }
  return source.slice(0, at) + next + source.slice(at + find.length)
}

// Cut everything from the start anchor up to (not including) the end anchor,
// stitching the surrounding text back together.
const removeSection = (source: string, start: string, end: string): string => {
  const from = source.indexOf(start)
  const to = source.indexOf(end)
  if (from === -1 || to === -1 || to <= from) {
    throw new Error(`QC section anchors missing or out of order: ${start}`)
  }
  return source.slice(0, from) + source.slice(to)
}

export const QC_CLEAN_DRAFT: QcDraft = {
  name: 'clean',
  draftBody: BASE_DRAFT,
  expectFlaggedCheckIds: [],
}

export const QC_BROKEN_DRAFTS: QcDraft[] = [
  {
    // Strips the entire "Compliance and Enforcement" article (permit gating,
    // certificate-of-occupancy, inspection, maintenance) — a real completeness
    // gap the grader should catch.
    name: 'missing-enforcement',
    draftBody: removeSection(
      BASE_DRAFT,
      '§ 560.7  Compliance and Enforcement.',
      '§ 560.8  Relationship to the Unified Development Ordinance.',
    ),
    expectFlaggedCheckIds: ['completeness'],
  },
  {
    // Swaps the North Carolina enabling statute for a California one — an
    // obvious jurisdictional mismatch for a Henderson, NC ordinance that
    // contradicts the NC authority finding on the record.
    name: 'wrong-jurisdiction-citation',
    draftBody: replaceOnce(
      BASE_DRAFT,
      'N.C.G.S. §§ 160D-702 and 160D-703',
      'California Government Code §§ 65850 and 65860',
    ),
    expectFlaggedCheckIds: ['authority', 'legal_conflict'],
  },
  {
    // Injects campaign framing addressed to voters into the findings section —
    // the opposite of the plain municipal-code voice addressed to constituents.
    name: 'campaign-voice',
    draftBody: replaceOnce(
      BASE_DRAFT,
      "advances the general welfare of Henderson's constituents.",
      "advances the general welfare of Henderson's constituents. Vote for" +
        ' me this November. My campaign has fought for bike-friendly' +
        ' streets from day one, and re-electing me is the surest way to' +
        ' get this passed.',
    ),
    expectFlaggedCheckIds: ['voice'],
  },
]
