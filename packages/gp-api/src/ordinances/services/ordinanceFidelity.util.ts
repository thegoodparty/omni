import { redlineToOriginal } from '@goodparty_org/contracts'

// Deterministic backstop to the amend-fidelity prompt rules. Reconstructs the
// "before" text an amendment's redline claims (unchanged + struck, dropping
// insertions) and compares it to the stored verbatim current law. Drift means
// the draft misrepresents the law it purports to amend: a paraphrased deletion,
// an omitted section (silent repeal), or invented "existing" text.

export interface AmendmentFidelityResult {
  ok: boolean
  // The "before" text the draft's redline claims (unchanged + struck),
  // normalized. Equal to `baseline` when the amendment is faithful; on drift,
  // the two together show exactly what the draft got wrong.
  reconstructed: string
  // The stored verbatim current law, normalized.
  baseline: string
}

// Ignore differences that don't change legal meaning: whitespace (\s also
// covers non-breaking spaces) and the common typographic variants a model swaps
// in (curly quotes, en/em dashes). Bounded on purpose — chasing perfect
// formatting equivalence causes false positives.
const normalize = (s: string): string =>
  s
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()

// Call only for amendments that have a stored verbatim baseline; an empty
// baseline is not a pass, it means there is nothing to check against.
export const checkAmendmentFidelity = (
  draftBody: string,
  verbatimBaseline: string,
): AmendmentFidelityResult => {
  const baseline = normalize(verbatimBaseline)
  const reconstructed = normalize(redlineToOriginal(draftBody))
  return { ok: baseline === reconstructed, reconstructed, baseline }
}
