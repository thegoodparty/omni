// Minimal route-level loading fallback for App Router `loading.tsx` streaming
// boundaries. Server component (no `'use client'`) — same centered spinner the
// FeatureFlagGuard and campaign-plan guards already use, so the streamed
// placeholder matches the app's existing loading states.
export const RouteLoading = (): React.JSX.Element => (
  <div className="flex h-[60vh] items-center justify-center">
    <div
      className="border-primary size-8 animate-spin rounded-full border-b-2"
      role="status"
      aria-label="Loading"
    />
  </div>
)

export default RouteLoading
