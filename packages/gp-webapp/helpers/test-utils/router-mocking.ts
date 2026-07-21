import { NextRouter } from 'next/router'
import { Mocked, vi } from 'vitest'

export const router: Partial<Mocked<NextRouter>> & { refresh: () => void } = {
  push: vi.fn(),
  replace: vi.fn(),
  back: vi.fn(),
  forward: vi.fn(),
  prefetch: vi.fn(),
  // next/navigation's app-router useRouter() (what vitest.setup.ts mocks to
  // return this object) includes refresh(), unlike the pages-router
  // NextRouter type this object is otherwise typed against.
  refresh: vi.fn(),
}
