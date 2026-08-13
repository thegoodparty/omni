// DI token for the civics-mart Databricks provider used to resolve a public
// profile's personId to the person's HubSpot contact id. Resolved by a factory
// in personProfiles.module.ts that returns null when DATABRICKS_* is
// unconfigured — consumers treat a null provider as "cannot resolve" and skip
// the CRM write rather than erroring.
export const PERSON_PROFILES_DATABRICKS = Symbol('PERSON_PROFILES_DATABRICKS')
