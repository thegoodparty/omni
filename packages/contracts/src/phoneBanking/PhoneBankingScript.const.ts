// The one contact-name token a phone-banking script may contain (ENG-10938,
// amending ENG-10932's "no placeholder brackets other than [your name]"
// rule). Generation emits it in the volunteer opener; the caller page
// interpolates it with the active contact's first name.
export const VOTER_NAME_TOKEN = '[voter name]'

// Serve's own token for the same slot: an elected official's script cannot say
// "voter" (the AC bans voter framing on that surface entirely). Both tokens
// mean "the active contact's first name", so every surface that interpolates
// one accepts either — a script is read back long after the flow that froze it,
// and which token it carries is a fact about that flow, not about the reader.
export const CONSTITUENT_NAME_TOKEN = '[constituent name]'

export const CONTACT_NAME_TOKENS = [
  VOTER_NAME_TOKEN,
  CONSTITUENT_NAME_TOKEN,
] as const
