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
const ADVICE_SIGNALS: RegExp[] = [
  /§/,
  /\bRCW\b/,
  /\bU\.S\.C\./,
  /\bStat\./,
  /\bstatute of limitations\b/i,
  /\bfile (?:a|an|your) (?:formal )?(?:complaint|charge|grievance) with\b/i,
  /\b(?:criminal|civil|legal) liability\b/i,
  /\b(?:criminally|civilly) liable\b/i,
  // Texting/robocall consent regimes and campaign-finance mechanics a
  // candidate might ask a scope about directly. Six of these pair the term
  // with a claim-shaped word next to it (consent, rules, applies, skip/miss,
  // required/optional), since the bare noun alone (an opt-in rate, a 10DLC
  // status update, a filing-deadline reminder) is ordinary Campaign Manager
  // subject matter, not advice. TCPA and "disclaimer requirement" stay bare:
  // neither shows up in routine operational chat the way the other six do.
  /\bopt-?in consent\b/i,
  /\bTCPA\b/i,
  /\b10DLC\b[^.]{0,20}\b(?:required|optional|mandatory|rules?|laws?)\b/i,
  /\brobocalls?\b[^.]{0,20}\b(?:rules?|laws?|consent|legal|allowed|fine)\b/i,
  /\bcontribution limits? (?:appl(?:y|ies)|does not apply|do not apply)\b/i,
  /\bcampaign finance (?:rules?|laws?|regulations?|requirements?)\b/i,
  /\bdisclaimer requirements?\b/i,
  /\b(?:skip|miss|waive|extend) (?:that |the |your )?filing deadlines?\b/i,
]

// Don't double the line when the model already wrote its own disclaimer (the
// Tier-3 prompt line working). Kept to phrasings that read as a disclaimer, not
// incidental prose ("consult a colleague") — a rare missed dedup is harmless,
// a suppressed-but-needed disclaimer is not.
const DISCLAIMER_PRESENT: RegExp[] = [
  /\b(?:not|isn'?t|is not) a substitute for\b/i,
  /\bqualified professional\b/i,
  /\bseek (?:professional|legal|medical|financial|tax) (?:advice|counsel|help)\b/i,
  // Requires the confirm-type verb near the office/attorney/board, not just
  // its name — naming the election office in passing (e.g. where to file
  // paperwork) is not a caution and must not suppress a real disclaimer.
  // Kept to two verbs on purpose: under-matching here only risks a rare
  // harmless double-append (see the comment above), so there's no reason
  // to widen it the way ADVICE_SIGNALS widens for recall.
  // Still whole-text, not localized to the advice itself, same as the three
  // phrases above: a real caution about one topic can still suppress the
  // line for unrelated advice elsewhere in the same reply. Tightening that
  // further needs to weigh the advice signal against the caution's position
  // in the text, not just its presence — out of scope for a regex pass.
  /\b(?:confirm|check)\b[^.]{0,30}\b(?:election (?:office|bureau|attorney)|state election board)\b/i,
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
