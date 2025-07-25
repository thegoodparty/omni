export const getUserFullName = (user: {
  firstName: string
  lastName: string
}) =>
  user?.firstName || user?.lastName
    ? `${user.firstName} ${user.lastName}`.trim()
    : ''
