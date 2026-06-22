// Experiment types intentionally excluded from the resume loop. The resume
// machinery (AWAITING_RESUME + sweepResumableRuns) exists for compliance_setup
// recovery; meeting briefings/schedules must never auto-resume even if a future
// agent manifest emits data_quality.overall='partial'. These strings mirror the
// SCHEDULE_EXPERIMENT_TYPE / BRIEFING_EXPERIMENT_TYPE constants in
// meetings/services/meetingBriefings.service.ts. Kept in a neutral module so
// both the queue consumer and experimentRuns.service can import it without a
// cycle.
export const NON_RESUMABLE_EXPERIMENT_TYPES = [
  'meeting_briefing',
  'meeting_schedule',
  'top_community_issues',
  'trending_issues',
] as const
