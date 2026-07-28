// DI token for the Win-warehouse Databricks provider the recommended-lists
// engine queries. Resolved by a factory in recommendedLists.module.ts that
// returns null when WIN_DATABRICKS_* is unconfigured — consumers treat a null
// provider as "unavailable" rather than erroring.
export const RECOMMENDED_LISTS_DATABRICKS = Symbol(
  'RECOMMENDED_LISTS_DATABRICKS',
)
