'use client'

import { useRouter } from 'next/navigation'
import FeatureFlagGuard from 'app/shared/experiments/FeatureFlagGuard'
import { WIN_EMAIL_OUTREACH_FLAG_KEY } from 'app/shared/experiments/winEmailOutreachFlag'
import { EmailFlow } from './EmailFlow'

const OUTREACH_PATH = '/dashboard/outreach'

export const EmailFlowPage = () => {
  const router = useRouter()
  return (
    <FeatureFlagGuard
      flagKey={WIN_EMAIL_OUTREACH_FLAG_KEY}
      redirectTo={OUTREACH_PATH}
    >
      <EmailFlow open onClose={() => router.push(OUTREACH_PATH)} />
    </FeatureFlagGuard>
  )
}
