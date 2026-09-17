// The one contact-name token a phone-banking script may contain (ENG-10938,
// amending ENG-10932's "no placeholder brackets other than [your name]"
// rule). Generation emits it in the volunteer opener; the caller page
// interpolates it with the active contact's first name.
export const VOTER_NAME_TOKEN = '[voter name]'
