'use client'

import { useRouter } from 'next/navigation'
import FeatureFlagGuard from 'app/shared/experiments/FeatureFlagGuard'
import { WIN_EMAIL_OUTREACH_FLAG_KEY } from 'app/shared/experiments/winEmailOutreachFlag'
import { OutreachFlowShell } from '../OutreachFlowShell'
import { EmailStatus } from './EmailStatus'
import { WIN_EMAIL_SURFACE } from './emailSurface'

const OUTREACH_PATH = '/dashboard/outreach'

export const EmailStatusPage = ({ id }: { id: number }) => {
  const router = useRouter()
  const close = () => router.push(OUTREACH_PATH)
  return (
    <FeatureFlagGuard
      flagKey={WIN_EMAIL_OUTREACH_FLAG_KEY}
      redirectTo={OUTREACH_PATH}
    >
      <OutreachFlowShell
        open
        onClose={close}
        title="Email"
        headerBadge="Email"
        currentStep={0}
        totalSteps={0}
        dirty={false}
        cta={{ label: 'Done', onClick: close }}
      >
        <EmailStatus surface={WIN_EMAIL_SURFACE} id={id} />
      </OutreachFlowShell>
    </FeatureFlagGuard>
  )
}
