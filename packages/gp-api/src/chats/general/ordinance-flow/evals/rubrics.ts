import type { RubricDimension } from './coldJudge'

// Per-step cold-judge rubrics, transcribed from the per-step design contract's
// "Judge" bullets. Each step leads with a faithfulness GATE (a blind judge
// returns pass/fail; a fail hard-fails the step regardless of the scores) and
// is followed by 1-3 SCORE dimensions graded 1-5 on the step's spine quality.
// Every prompt is self-contained so a judge can apply it to one artifact with
// no other context.

export type RubricStep =
  | 'clarify'
  | 'authority'
  | 'current_law'
  | 'comparables'
  | 'draft'

// Step 1 — Clarify. Gate: no fabricated facts/sources on any option or
// rationale. Score: parameter-grade questions; genuinely distinct, sourced
// options.
export const clarifyRubric: RubricDimension[] = [
  {
    key: 'clarify_no_fabricated_facts',
    kind: 'gate',
    prompt: [
      'This artifact is one clarifying question the ordinance agent asked,',
      'with its 2-4 answer options and each option\'s "why this option"',
      'rationale. Any option or rationale that states a fact (a statistic, a',
      'legal requirement, an example jurisdiction) must cite a real,',
      'verifiable source. PASS if every factual claim carries a real source',
      'and nothing is invented or misattributed. FAIL if any statute, number,',
      'or example is fabricated, or a factual claim is presented with no',
      'source.',
    ].join(' '),
  },
  {
    key: 'clarify_parameter_grade',
    kind: 'score',
    prompt: [
      'Judge whether the question is parameter-grade: does answering it pin a',
      'concrete policy parameter a drafter needs (a threshold, a ratio, an',
      'applicability scope, an enforcement mechanism, or a',
      'flexibility/exemption rule)? Score 1 (vague, opinion-seeking, or',
      'answerable without changing any draft provision) to 5 (the answer maps',
      'directly to a specific drafting decision).',
    ].join(' '),
  },
  {
    key: 'clarify_distinct_sourced_options',
    kind: 'score',
    prompt: [
      'Judge the answer options. Score 1 to 5 on whether the 2-4 options are',
      'genuinely distinct choices (not restatements of one another), each',
      'carries a short "why this option" rationale, and any option framed as',
      'factual cites a real source. 5 = distinct, each well-rationaled,',
      'factual ones sourced; 1 = overlapping or unmotivated options.',
    ].join(' '),
  },
]

// Step 2 — Authority. Gate: the cited statute/charter provision is real and
// on-point. Score: the verdict translates the finding into plain meaning.
export const authorityRubric: RubricDimension[] = [
  {
    key: 'authority_citation_real',
    kind: 'gate',
    prompt: [
      'This artifact is the authority verdict card: a status, an explanation,',
      'and a cited statute or charter provision with its source. PASS only if',
      "the cited provision is real and on-point for this jurisdiction's power",
      'to enact the ordinance. FAIL if the citation is invented, misquoted, or',
      'points to a provision that does not actually grant the claimed',
      'authority.',
    ].join(' '),
  },
  {
    key: 'authority_plain_meaning',
    kind: 'score',
    prompt: [
      'Judge whether the verdict translates the legal finding into a plain',
      '"what this means for you" confirmation the elected official can act on.',
      'Score 1 (a raw legal citation with no interpretation) to 5 (clearly',
      'states, in plain language, whether they can proceed and any condition',
      'attached).',
    ].join(' '),
  },
]

// Step 3 — Current law. Gate: does/gaps and any history trace to the fetched
// chapter. Score: gaps map to the clarify goals.
export const currentLawRubric: RubricDimension[] = [
  {
    key: 'current_law_traces_to_code',
    kind: 'gate',
    prompt: [
      "This artifact summarizes what the jurisdiction's current code does",
      '("does") and where it falls short ("gaps"), plus optional',
      'legislative-history entries, cited to a fetched chapter. PASS only if',
      'every "does" and "gap" claim traces to the fetched chapter text or the',
      'ground truth. A history entry that TRANSPARENTLY marks itself estimated',
      'or unconfirmed (e.g. "adoption year estimated, not independently',
      'confirmed") is acceptable — honest hedging is preferred over omission',
      'and is NOT a violation; only an entry asserted AS FACT that is invented',
      'or contradicts the source fails. Judge the substantive findings, not the',
      "agent's narration of its own research process — notes that a PDF was",
      'blocked, a page would not load, or a source could not be reached are',
      'process notes, not unfaithful claims. FAIL if a "does"/"gap" claim, a',
      'section number, a date, or a quote is invented or contradicts the cited',
      'source.',
    ].join(' '),
  },
  {
    key: 'current_law_gaps_map_to_goals',
    kind: 'score',
    prompt: [
      "Judge whether the identified gaps map to the user's stated goals from",
      'the clarify step: each gap should name a place current law does not yet',
      'do what the user wants. Score 1 (gaps are generic or unrelated to the',
      'goal) to 5 (each gap is the specific shortfall the new ordinance would',
      'close).',
    ].join(' '),
  },
]

// Step 4 — Comparables. Gate: real jurisdictions and real measures. Score:
// same-state-first ordering; an instructive failure; takeaway tied to goal.
export const comparablesRubric: RubricDimension[] = [
  {
    key: 'comparables_real_jurisdictions',
    kind: 'gate',
    prompt: [
      'This artifact is a set of 3-5 comparable-ordinance cards (city, state,',
      'year, headline, status, a quote, outcome). PASS if each card is a real',
      'jurisdiction whose measure plausibly exists, is cited to a PRIMARY',
      'source (the actual municipal code or an official/named report — not a',
      'vendor, consultant, or aggregator summary), the quote is consistent with',
      'its own excerpt/source, and nothing contradicts the verification',
      'evidence provided. FAIL on positive evidence of unfaithfulness: a',
      'fabricated jurisdiction or measure; a secondary/aggregator/vendor site',
      'presented as the primary ordinance source; a quote that is a paraphrase',
      'or a derived calculation dressed as verbatim code; a quote that',
      'contradicts its own cited excerpt; or a year or figure that contradicts',
      'the source. Do NOT fail merely because you cannot independently',
      'transcribe-verify an exact quote from a primary citation you cannot open',
      '— that is residual uncertainty, not fabrication.',
    ].join(' '),
  },
  {
    key: 'comparables_same_state_first',
    kind: 'score',
    prompt: [
      'Judge ordering. Score 1 to 5 on whether same-state peers, then nearest,',
      'then farthest, are surfaced first when they exist. 5 = closest-to-home',
      'ordering honored; 1 = distant jurisdictions lead while relevant',
      'same-state peers exist and are omitted or buried. If no same-state peer',
      'plausibly exists, score on nearest-first ordering.',
    ].join(' '),
  },
  {
    key: 'comparables_instructive_failure',
    kind: 'score',
    prompt: [
      'Judge whether at least one card is an instructive failure: a repealed',
      'or failed measure with its failure reason, so the user learns what to',
      'avoid, not only what worked. Score 1 (all successes, no cautionary',
      'case) to 5 (a genuine failure included with a clear lesson).',
    ].join(' '),
  },
  {
    key: 'comparables_takeaway_ties_to_goal',
    kind: 'score',
    prompt: [
      'Judge the takeaway. Score 1 to 5 on whether it ties the comparables',
      "back to the user's specific goal for this ordinance (what to adopt or",
      'avoid), rather than restating the cards. 5 = actionable and',
      'goal-anchored; 1 = a generic summary with no synthesis.',
    ].join(' '),
  },
]

// Step 5 — Draft. Gate: every provision traces to a settled answer/prior step,
// no invented statute. Score: bracketed open calls; municipal-code voice.
export const draftRubric: RubricDimension[] = [
  {
    key: 'draft_provisions_trace',
    kind: 'gate',
    prompt: [
      'This artifact is the drafted ordinance plus the prior-step material',
      '(settled clarify answers, current-law findings, comparables). PASS only',
      'if every substantive provision traces to a settled clarify answer or a',
      'prior-step finding and no statute or figure is invented. FAIL if the',
      'draft introduces a policy the user never agreed to, cites a statute not',
      'established earlier, or states a figure with no basis in the answers.',
    ].join(' '),
  },
  {
    key: 'draft_bracketed_open_calls',
    kind: 'score',
    prompt: [
      'Judge how genuine open calls are handled. Score 1 to 5 on whether',
      'decisions the council still must make appear as clearly bracketed',
      'placeholders (e.g. "[fine amount to be set by council]") rather than',
      'silently invented figures. 5 = every unsettled value is a visible',
      'placeholder; 1 = the draft fills unsettled values with fabricated',
      'numbers.',
    ].join(' '),
  },
  {
    key: 'draft_municipal_voice',
    kind: 'score',
    prompt: [
      'Judge voice. Score 1 to 5 on whether the draft reads as plain',
      'municipal-code prose addressed to constituents: section-numbered,',
      'governance-focused, no campaign or political framing, never "voters".',
      '5 = clean municipal-code voice; 1 = campaign or marketing tone, or the',
      'reader is misaddressed.',
    ].join(' '),
  },
]

export const stepRubrics: Record<RubricStep, RubricDimension[]> = {
  clarify: clarifyRubric,
  authority: authorityRubric,
  current_law: currentLawRubric,
  comparables: comparablesRubric,
  draft: draftRubric,
}
