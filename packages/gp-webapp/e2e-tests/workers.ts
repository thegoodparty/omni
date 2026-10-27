// Read by playwright.config.ts (how many workers each process runs) and by
// the Clerk throttle (how many workers a whole run shares Clerk's budget
// across), so the two cannot drift apart.
//
// CI favors workers over shards: the tests mostly wait on a remote preview,
// so a 4-core runner keeps up with 6 browsers, and each extra worker shares
// its shard's setup (dependency restore, browser install) where each extra
// shard pays that setup again on a runner of its own.
export const WORKERS_PER_SHARD = process.env.CI ? 6 : 4
