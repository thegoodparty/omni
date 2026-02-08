import {
  SearchUsersParams,
  SearchUsersResult,
  User,
  SEARCH_PARAMS,
} from './types'

/**
 * Stub function to search users - replace with actual API call later
 */
export async function searchUsers(
  params: SearchUsersParams
): Promise<SearchUsersResult | null> {
  // TODO: Replace with actual API call

  // Simulate API delay
  await new Promise((resolve) => setTimeout(resolve, 500))

  const stubUsers: User[] = [
    {
      id: '4170',
      email: 'matthew@goodparty.org',
      firstName: 'Matthew',
      lastName: 'Marcus',
      phone: '+1 555-123-4567',
    },
    {
      id: '595',
      email: 'tomer@goodparty.org',
      firstName: 'Tomer',
      lastName: 'Almog',
      phone: '+1 310-975-9102',
    },
    {
      id: '38943',
      email: 'bryant@goodparty.org',
      firstName: 'Bryant',
      lastName: 'Levine',
      phone: '+1 555-987-6543',
    },
  ]

  if (params[SEARCH_PARAMS.EMAIL]) {
    const user = stubUsers.find(
      (u) =>
        u.email.toLowerCase() === params[SEARCH_PARAMS.EMAIL]?.toLowerCase()
    )
    return user ? [user] : []
  }

  if (params[SEARCH_PARAMS.FIRST_NAME] || params[SEARCH_PARAMS.LAST_NAME]) {
    return stubUsers
  }

  return null
}
