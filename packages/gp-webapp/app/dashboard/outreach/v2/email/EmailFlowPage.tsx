'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import type { EmailSend } from '@goodparty_org/contracts'
import FeatureFlagGuard from 'app/shared/experiments/FeatureFlagGuard'
import { WIN_EMAIL_OUTREACH_FLAG_KEY } from 'app/shared/experiments/winEmailOutreachFlag'
import { EmailFlow } from './EmailFlow'
import { useEmailSend } from './emailApi'

const OUTREACH_PATH = '/dashboard/outreach'

// Only a draft reopens in the flow. Anything else, or an id that doesn't
// load, goes to its status page. The first read decides: the flow's own
// saves and payment change the send under it afterwards.
const DraftEmailFlow = ({
  id,
  onClose,
}: {
  id: number
  onClose: () => void
}) => {
  const router = useRouter()
  const { data, isError } = useEmailSend(false, id)
  const [draft, setDraft] = useState<EmailSend | null>(null)
  useEffect(() => {
    if (draft) return
    if (isError || (data && data.status !== 'draft')) {
      router.replace(`${OUTREACH_PATH}/email/${id}`)
      return
    }
    if (data) setDraft(data)
  }, [data, draft, id, isError, router])
  if (!draft) return null
  return <EmailFlow open onClose={onClose} draft={draft} />
}

export const EmailFlowPage = ({ draftId }: { draftId?: number }) => {
  const router = useRouter()
  const close = () => router.push(OUTREACH_PATH)
  return (
    <FeatureFlagGuard
      flagKey={WIN_EMAIL_OUTREACH_FLAG_KEY}
      redirectTo={OUTREACH_PATH}
    >
      {draftId === undefined ? (
        <EmailFlow open onClose={close} />
      ) : (
        <DraftEmailFlow id={draftId} onClose={close} />
      )}
    </FeatureFlagGuard>
  )
}
