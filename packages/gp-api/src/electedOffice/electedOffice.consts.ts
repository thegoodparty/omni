// Per-user Postgres advisory-lock key serializing elected-office creation.
// Task 01 (PR #117) dropped the @@unique([userId]) constraint and its P2002
// recovery, so concurrent first-office creates would otherwise produce two
// active offices + two orphan organizations. The first lock argument is a
// namespace distinct from the campaigns.consts keys (918_273/274/276) so the
// office-creation and campaign locks never collide; userId is the second.
export const ELECTED_OFFICE_CREATE_ADVISORY_LOCK_KEY = 918_277
