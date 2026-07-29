// Clerk machine-to-machine tokens are prefixed with `mt_`. election-api only
// accepts these (it has no user sessions); anything else is rejected.
export const M2M_TOKEN_PREFIX = 'mt_'
