import { Spinner } from '@styleguide'

// Minimal route-level loading fallback for App Router `loading.tsx` streaming
// boundaries. Server component (no `'use client'`) — wraps the shared
// Spinner in a centered section so a streamed placeholder matches the
// app's canonical waiting state.
export const RouteLoading = (): React.JSX.Element => (
  <div className="flex h-[60vh] items-center justify-center">
    <Spinner />
  </div>
)

export default RouteLoading
