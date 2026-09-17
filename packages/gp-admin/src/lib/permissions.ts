export const ROLES = {
  ADMIN: 'org:admin',
  SALES: 'org:sales',
  READ_ONLY: 'org:read_only',
} as const

export const PERMISSIONS = {
  READ_USERS: 'org:admin_portal:read_users',
  WRITE_USERS: 'org:admin_portal:write_users',
  READ_CAMPAIGNS: 'org:admin_portal:read_campaigns',
  WRITE_CAMPAIGNS: 'org:admin_portal:write_campaigns',
  MANAGE_SETTINGS: 'org:admin_portal:manage_settings',
  MANAGE_INVITES: 'org:admin_portal:manage_invites',
  MANAGE_ECANVASSER: 'org:admin_portal:manage_ecanvasser',
  IMPERSONATE_USERS: 'org:admin_portal:impersonate_users',
  READ_AGENT_RUNS: 'org:admin_portal:read_agent_runs',
  WRITE_AGENT_RUNS: 'org:admin_portal:write_agent_runs',
  REVIEW_BRIEFINGS: 'org:admin_portal:review_briefings',
  // Taking a public /people page down is irreversible from the subject's point
  // of view and usually honors a legal request, so it gets its own permission
  // rather than riding on write_users — sales and read_only must not have it.
  MANAGE_PERSON_REMOVALS: 'org:admin_portal:manage_person_removals',
} as const

export type Role = (typeof ROLES)[keyof typeof ROLES]
export type Permission = (typeof PERMISSIONS)[keyof typeof PERMISSIONS]
