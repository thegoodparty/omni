import type { ReactNode } from 'react'
import FeatureFlagGuard from '@shared/experiments/FeatureFlagGuard'
import { ORDINANCES_FLAG_KEY } from '@shared/experiments/ordinancesFlag'

// Gate every /ordinances* route behind the serve-ordinances flag so the whole
// feature ships dark until ramped in Amplitude.
export default function OrdinancesLayout({
  children,
}: {
  children: ReactNode
}): React.JSX.Element {
  return (
    <FeatureFlagGuard flagKey={ORDINANCES_FLAG_KEY}>
      {children}
    </FeatureFlagGuard>
  )
}
