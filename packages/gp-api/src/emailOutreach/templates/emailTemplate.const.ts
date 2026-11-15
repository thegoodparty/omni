export const EMAIL_POSTAL_ADDRESS =
  '916 Silver Spur Rd #310, Rolling Hills Estates, CA 90274'

export const EMAIL_VARIABLES = {
  firstName: 'first_name',
  lastName: 'last_name',
  unsubscribeUrl: 'unsubscribe_url',
} as const

export const emailVariableToken = (name: string): string => `{{${name}}}`

// No campaign or office stores a time zone, so the masthead date is the
// Pacific calendar day: the server runs in UTC, which would show an evening
// Pacific send as the next day.
export const EMAIL_MASTHEAD_TIME_ZONE = 'America/Los_Angeles'
