// Tier-1 deterministic backstop for the professional-advice disclaimer, used
// by any chat scope that wants it (today: Chief of Staff, Campaign
// Manager). The upstream line the model is asked to write itself lives in
// PROFESSIONAL_ADVICE_BLOCK, in the Chief of Staff prompt
// (chief-of-staff/services/chiefOfStaffPrompt.ts); this catches the turns
// where a scope gave professional-domain advice but skipped that line.
// High-precision signals only: a paraphrased-advice miss is acceptable
// here, a false append on ordinary prose is not (a small-model classifier
// would cover the misses and is a separate, later tier).

export const PROFESSIONAL_ADVICE_DISCLAIMER =
  'This is not a substitute for professional advice. Confirm with a ' +
  'qualified professional before acting on it.'

// The exact failure from the CoS eval qual review: statute citations,
// explicit legal/criminal liability, and formal-complaint filing language.
// Each non-citation term carries a companion constraint, since the bare
// term also shows up in agenda summaries and constituent-services prose
// ("the civil liability claim", "file a complaint with Public Works",
// "the statute of limitations reform bill") that is not advice.
const ADVICE_SIGNALS: RegExp[] = [
  /§/,
  /\bRCW\b/,
  /\bU\.S\.C\./,
  // Anchored on the volume/page numbers ("47 Stat. 454"): bare "Stat." is
  // also urgency slang and an abbreviation for "State"/"Statistical".
  /\d+\s+Stat\.\s+\d+/,
  /\bstatute of limitations (?:\w+ )?(?:on|for|has|had|is|was|expires?|expired|ran|runs|appl(?:y|ies)|passed)\b/i,
  /\bfile (?:a|an|your) (?:formal )?(?:complaint|charge|grievance) with\b[^.!?\n]{0,30}\b(?:state|county|federal|secretary of state|clerk|election|ethics|attorney general|court|board|commission|FEC|FCC|EEOC)\b/i,
  // "liability" as a modifier ("liability claim/insurance") names a thing,
  // not someone's exposure to it.
  /\b(?:criminal|civil|legal) liability\b(?!\s+(?:claims?|insurance|polic(?:y|ies)|coverage|settlements?|waivers?|releases?)\b)/i,
  /\b(?:criminally|civilly) liable\b/i,
  // Texting/robocall consent regimes and campaign-finance mechanics a
  // candidate might ask a scope about directly. Every one pairs the term
  // with a claim-shaped word next to it (need/require, rules, legal,
  // applies to, skip/waive, required/optional), since the bare noun alone
  // (an opt-in rate or opt-in consent checkbox, a 10DLC or TCPA status
  // update, a robocall send report, a routine disclaimer-requirement
  // setting, a "campaign finance rules" link, a filing-deadline reminder)
  // is ordinary Campaign Manager subject matter, not advice. Words that
  // read as a status or product report were dropped from the pairings:
  // "miss" (a deadline), "fine" and "allowed" (a robocall on the free
  // plan), "consent" (a stored consent record), "extend" (an announced
  // deadline change). Hyphen and space variants are accepted since the
  // model writes "robo-calls", "10 DLC", and "campaign-finance" too.
  /\b(?:need|needs|needed|require[sd]?|requiring|without) (?:\w+[- ])?opt[- ]?in consent\b|\bopt[- ]?in consent (?:is|isn'?t|are|aren'?t|was) (?:not |never |always )?(?:required|needed|necessary|optional|mandatory)\b/i,
  /\bTCPA\b[^.!?\n]{0,20}\b(?:rules?|laws?|liability|violation|appl(?:y|ies)|required|exempt)\b/i,
  /\b10[- ]?DLC\b[^.!?\n]{0,20}\b(?:required|optional|mandatory|rules?|laws?)\b/i,
  /\brobo[- ]?calls?\b[^.!?\n]{0,20}\b(?:rules?|laws?|legal|illegal)\b/i,
  /\bcontribution limits? (?:appl(?:y|ies) to|(?:does|do)(?: not|n'?t) apply)\b/i,
  /\bcampaign[- ]finance (?:rules?|laws?|regulations?|requirements?)\b[^.!?\n]{0,20}\b(?:appl(?:y|ies)|requires?|allows?|permits?)\b/i,
  /\bdisclaimer requirements? (?:appl(?:y|ies)|(?:does|do) not apply|required|optional|mandatory|rules?|laws?)\b/i,
  /\b(?:skip|waive) (?:that |the |your )?filing deadlines?\b/i,
]

// Don't double the line when the model already wrote its own caution (the
// Chief of Staff prompt's own line, or a spontaneous one in any scope).
// Kept to phrasings shaped like a caution, not incidental prose: a rare
// missed dedup is a harmless double line, a suppressed-but-needed
// disclaimer is not. So each phrase needs its caution shape spelled out.
// "Not a substitute for" alone also compares tactics ("not a substitute
// for door knocking"), "qualified professional" alone also describes a
// photographer, "seek legal help" also appears inside a drafted
// constituent reply, and "don't rely on this response" also starts
// "don't rely on this response rate".
const DISCLAIMER_PRESENT: RegExp[] = [
  /\b(?:not|isn'?t|is not) a substitute for (?:professional |legal |financial |tax |medical )?(?:advice|counsel)\b/i,
  /\b(?:confirm|check|consult|verify|ask)\b[^.!?\n]{0,30}\bqualified professional\b/i,
  /\bseek (?:professional|legal|medical|financial|tax) (?:advice|counsel)\b[^.!?\n]{0,30}\bbefore\b/i,
  /\b(?:do not|don'?t) rely on (?:my|this) (?:answer|reply|response)\b(?!\s+(?:rates?|counts?|times?)\b)/i,
  // Requires the confirm-type verb near the office/attorney/board, not just
  // its name — naming the election office in passing (e.g. where to file
  // paperwork) is not a caution and must not suppress a real disclaimer.
  // Also requires "before (you) rely(ing) on" after it, so an operational
  // lookup ("check the election office hours", "confirm with the election
  // office how many voters rely on mail ballots") doesn't read as a
  // caution either — only a phrase shaped like the real thing does. Both
  // gaps stop at !/?/newline as well as a period, so an operational clause
  // can't reach an unrelated "rely on" across a sentence break that isn't
  // a period.
  // Kept to two verbs on purpose: under-matching here only risks a rare
  // harmless double-append (see the comment above), so there's no reason
  // to widen it the way ADVICE_SIGNALS widens for recall.
  // Still whole-text, not localized to the advice itself, same as the four
  // phrases above: a real caution about one topic can still suppress the
  // line for unrelated advice elsewhere in the same reply. Tightening that
  // further needs to weigh the advice signal against the caution's position
  // in the text, not just its presence — out of scope for a regex pass.
  /\b(?:confirm|check)\b[^.!?\n]{0,30}\b(?:election (?:office|bureau|attorney)|state election board)\b[^.!?\n]{0,40}\bbefore (?:you )?rel(?:y|ying) on\b/i,
]

// Returns the line to append (with a leading blank line) when the response
// reads as professional-domain advice and carries no disclaimer yet; null
// otherwise. Declines never match — they carry none of these signals — so the
// prompt's "only on substantive answers" rule holds without a separate check.
export const professionalAdviceDisclaimer = (text: string): string | null => {
  if (!text.trim()) return null
  if (DISCLAIMER_PRESENT.some((re) => re.test(text))) return null
  if (!ADVICE_SIGNALS.some((re) => re.test(text))) return null
  return `\n\n${PROFESSIONAL_ADVICE_DISCLAIMER}`
}
