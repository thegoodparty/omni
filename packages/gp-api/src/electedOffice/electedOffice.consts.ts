// Per-user Postgres advisory-lock key serializing elected-office creation.
// Task 01 (PR #117) dropped the @@unique([userId]) constraint and its P2002
// recovery, so concurrent first-office creates would otherwise produce two
// active offices + two orphan organizations. The first lock argument is a
// namespace distinct from the campaigns.consts keys (918_273/274/276) so the
// office-creation and campaign locks never collide; userId is the second.
export const ELECTED_OFFICE_CREATE_ADVISORY_LOCK_KEY = 918_277

// DI token for resolving ElectedOfficeService via ModuleRef instead of
// constructor injection. OrganizationsService needs it for the office-change
// invalidation hook, but ElectedOfficeService's own constructor already
// depends (transitively, through its dispatch services) on a long import
// chain that loops back through OrganizationsService's file. A plain
// constructor injection of the class would make organizations.service.ts
// eagerly `require` that whole chain, corrupting the reflected constructor
// metadata of an unrelated class caught mid-cycle. Looking it up by this
// token at call time (see PaymentEventsService's RaceOpponentService use of
// the same pattern) never triggers that eager import.
export const ELECTED_OFFICE_SERVICE_TOKEN = Symbol('ElectedOfficeService')
