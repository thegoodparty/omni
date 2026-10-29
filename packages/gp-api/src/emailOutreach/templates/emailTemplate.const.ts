export const EMAIL_POSTAL_ADDRESS =
  '916 Silver Spur Rd #310, Rolling Hills Estates, CA 90274'

export const EMAIL_VARIABLES = {
  firstName: 'first_name',
  lastName: 'last_name',
  unsubscribeUrl: 'unsubscribe_url',
} as const

export const emailVariableToken = (name: string): string => `{{${name}}}`
