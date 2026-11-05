'use client'

import { useRouter } from 'next/navigation'
import FeatureFlagGuard from 'app/shared/experiments/FeatureFlagGuard'
import { WIN_EMAIL_OUTREACH_FLAG_KEY } from 'app/shared/experiments/winEmailOutreachFlag'
import { OutreachFlowShell } from '../OutreachFlowShell'
import { RESUME_COPY } from '../gate/gateCopy'
import { EmailStatus } from './EmailStatus'
import { useEmailSend } from './emailApi'
import { emailDraftHref } from './emailFlow.util'
import { WIN_EMAIL_SURFACE } from './emailSurface'

const OUTREACH_PATH = '/dashboard/outreach'

export const EmailStatusPage = ({ id }: { id: number }) => {
  const router = useRouter()
  const close = () => router.push(OUTREACH_PATH)
  const { data: send } = useEmailSend(false, id)
  // A draft's way forward is back into the flow, where it was left.
  const cta =
    send?.status === 'draft'
      ? {
          label: RESUME_COPY.email.cta,
          onClick: () => router.push(emailDraftHref(id)),
        }
      : { label: 'Done', onClick: close }
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
        cta={cta}
      >
        <EmailStatus surface={WIN_EMAIL_SURFACE} id={id} />
      </OutreachFlowShell>
    </FeatureFlagGuard>
  )
}
