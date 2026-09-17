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
  /\d+\s+Stat\.\s+\d+/,
  /\bstatute of limitations\b/i,
  /\bfile (?:a|an|your) (?:formal )?(?:complaint|charge|grievance) with\b/i,
  /\b(?:criminal|civil|legal) liability\b/i,
  /\b(?:criminally|civilly) liable\b/i,
  // Texting/robocall consent regimes and campaign-finance mechanics a
  // candidate might ask a scope about directly. Every one pairs the term
  // with a claim-shaped word next to it (consent, rules, applies, skip,
  // required/optional), since the bare noun alone (an opt-in rate, a 10DLC
  // or TCPA status update, a routine disclaimer-requirement setting, a
  // "campaign finance rules" link, a filing-deadline reminder) is ordinary
  // Campaign Manager subject matter, not advice. "miss" was dropped from
  // the filing-deadline pairing and "fine" from the robocall one: both
  // read as a plain status report ("you'll miss it if you wait", "the
  // robocall went fine"), not a claim about whether the deadline or the
  // call itself is optional or permitted.
  /\bopt[- ]?in consent\b/i,
  /\bTCPA\b[^.!?\n]{0,20}\b(?:rules?|laws?|consent|liability|violation|appl(?:y|ies)|required|exempt)\b/i,
  /\b10DLC\b[^.!?\n]{0,20}\b(?:required|optional|mandatory|rules?|laws?)\b/i,
  /\brobocalls?\b[^.!?\n]{0,20}\b(?:rules?|laws?|consent|legal|allowed)\b/i,
  /\bcontribution limits? (?:appl(?:y|ies)|does not apply|do not apply)\b/i,
  /\bcampaign finance (?:rules?|laws?|regulations?|requirements?)\b[^.!?\n]{0,20}\b(?:appl(?:y|ies)|requires?|allows?|permits?)\b/i,
  /\bdisclaimer requirements? (?:appl(?:y|ies)|(?:does|do) not apply|required|optional|mandatory|rules?|laws?)\b/i,
  /\b(?:skip|waive|extend) (?:that |the |your )?filing deadlines?\b/i,
]

// Don't double the line when the model already wrote its own disclaimer (the
// Tier-3 prompt line working). Kept to phrasings that read as a disclaimer, not
// incidental prose ("consult a colleague") — a rare missed dedup is harmless,
// a suppressed-but-needed disclaimer is not.
const DISCLAIMER_PRESENT: RegExp[] = [
  /\b(?:not|isn'?t|is not) a substitute for\b/i,
  /\bqualified professional\b/i,
  /\bseek (?:professional|legal|medical|financial|tax) (?:advice|counsel|help)\b/i,
  // A reply that tells the reader not to rely on it for a legal or
  // compliance question is itself the caution, whoever it points them to.
  /\b(?:do not|don'?t) rely on (?:my|this) (?:answer|reply|response)\b/i,
  // Requires the confirm-type verb near the office/attorney/board, not just
  // its name — naming the election office in passing (e.g. where to file
  // paperwork) is not a caution and must not suppress a real disclaimer.
  // Also requires a "rely on" phrase after it, so an operational lookup
  // ("check the election office's hours") doesn't read as a caution
  // either — only a phrase shaped like the real thing does. Both gaps
  // stop at !/?/newline as well as a period, so an operational clause
  // can't reach an unrelated "rely on" across a sentence break that
  // isn't a period. Deliberately not looking for a negation ("don't
  // rely on") in front of it: pointing reliance at the office/attorney/
  // board instead of the model's own answer ("that's what voters can
  // rely on") is the same protective redirect this check exists to
  // recognize, whichever way it's phrased.
  // Kept to two verbs on purpose: under-matching here only risks a rare
  // harmless double-append (see the comment above), so there's no reason
  // to widen it the way ADVICE_SIGNALS widens for recall.
  // Still whole-text, not localized to the advice itself, same as the three
  // phrases above: a real caution about one topic can still suppress the
  // line for unrelated advice elsewhere in the same reply. Tightening that
  // further needs to weigh the advice signal against the caution's position
  // in the text, not just its presence — out of scope for a regex pass.
  /\b(?:confirm|check)\b[^.!?\n]{0,30}\b(?:election (?:office|bureau|attorney)|state election board)\b[^.!?\n]{0,40}\brely on\b/i,
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
