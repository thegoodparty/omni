export const EMAIL_POSTAL_ADDRESS =
  '916 Silver Spur Rd #310, Rolling Hills Estates, CA 90274'

// The heart beside a photo_letter's profile link. A PNG, since Gmail and
// Outlook drop SVG; served from gp-webapp's public folder like the samples.
export const EMAIL_GOODPARTY_LOGO_URL =
  'https://app.goodparty.org/images/email-samples/goodparty-heart.png'

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
