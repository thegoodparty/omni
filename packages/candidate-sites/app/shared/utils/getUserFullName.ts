export const getUserFullName = (user?: {
  firstName: string | null
  lastName: string | null
}) => [user?.firstName, user?.lastName].filter(Boolean).join(' ').trim()
