import { vi } from 'vitest'

// clerkThrottle is one module-level limiter (50 calls per 10s, 200ms apart).
// Under isolate:false it is shared by every file a worker runs, so a fast
// worker drains it and a later test waits out refills until it times out. No
// test reaches the real Clerk API, so the spacing protects nothing here.
vi.mock('@/vendors/clerk/util/clerkThrottle.util', () => ({
  clerkThrottle: <T>(fn: () => Promise<T>): Promise<T> => fn(),
}))
