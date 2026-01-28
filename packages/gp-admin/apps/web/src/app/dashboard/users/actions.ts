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
      id: '1',
      email: 'john.doe@example.com',
      firstName: 'John',
      lastName: 'Doe',
      phone: '+1 555-123-4567',
    },
    {
      id: '2',
      email: 'jane.smith@example.com',
      firstName: 'Jane',
      lastName: 'Smith',
      phone: '+1 555-987-6543',
    },
    {
      id: '3',
      email: 'bob.wilson@example.com',
      firstName: 'Bob',
      lastName: 'Wilson',
      phone: null,
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
