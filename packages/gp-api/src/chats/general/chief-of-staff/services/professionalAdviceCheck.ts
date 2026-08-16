// Tier-1 deterministic backstop for the professional-advice disclaimer. The
// upstream line the model is asked to write itself lives in
// PROFESSIONAL_ADVICE_BLOCK (chiefOfStaffPrompt.ts); this catches the turns
// where it gave professional-domain advice but skipped that line. High-
// precision signals only: a paraphrased-advice miss is acceptable here, a
// false append on ordinary prose is not (a small-model classifier would cover
// the misses and is a separate, later tier).

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
]

// Don't double the line when the model already wrote its own disclaimer (the
// Tier-3 prompt line working). Kept to phrasings that read as a disclaimer, not
// incidental prose ("consult a colleague") — a rare missed dedup is harmless,
// a suppressed-but-needed disclaimer is not.
const DISCLAIMER_PRESENT: RegExp[] = [
  /\b(?:not|isn'?t|is not) a substitute for\b/i,
  /\bqualified professional\b/i,
  /\bseek (?:professional|legal|medical|financial|tax) (?:advice|counsel|help)\b/i,
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
