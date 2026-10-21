// Shared prompt-injection guard. Strips chat-template / role delimiters that an
// untrusted source (user message, candidate-entered campaign details, briefing
// content) could use to break out of its data section and impersonate the
// system/user/assistant. Used by both the briefing and campaign assistants.

const DELIMITER_REMOVED = '[delimiter-removed]'

const DELIMITER_PATTERNS: RegExp[] = [
  /<\/?attached_documents\s*>?/gi,
  /<\/?briefing_content\s*>?/gi,
  /<\/?briefing\s*>?/gi,
  /<\/?user_data\s*>?/gi,
  /<\/?ordinance_context\s*>?/gi,
  /<\/?prior_steps\s*>?/gi,
  /<\/?scratchpad\s*>?/gi,
  /<\/?current_step\s*>?/gi,
  // Chief of Staff and the priority flow frame their data in these, and a
  // check written by one agent is read by the other, so a closing tag in that
  // text would end the data section early. \b keeps <priority from eating
  // <priorities.
  /<\/?priorities\b\s*>?/gi,
  /<\/?priority\b\s*>?/gi,
  /<\/?office_context\b\s*>?/gi,
  /<\/?anchored_issue\b\s*>?/gi,
  /<\/?product_map\b\s*>?/gi,
  /<\/?status\b\s*>?/gi,
  /<\/?thread\b\s*>?/gi,
  /<\/?system\s*>?/gi,
  /<\/?instructions\s*>?/gi,
  /<\|im_start\|>/gi,
  /<\|im_end\|>/gi,
  /<\|system\|>/gi,
  /<\|user\|>/gi,
  /<\|assistant\|>/gi,
]

export const sanitizeUntrustedContent = (s: string): string =>
  DELIMITER_PATTERNS.reduce((acc, re) => acc.replace(re, DELIMITER_REMOVED), s)
