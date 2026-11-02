// `GET /v1/elected-office/mine`, read by DashboardLayout to send an
// unfinished ever-Pro winner back to Serve onboarding. Whatever creates an office
// invalidates it, so that redirect sees the new one.
export const MY_ELECTED_OFFICES_QUERY_KEY = ['elected-office', 'mine'] as const
