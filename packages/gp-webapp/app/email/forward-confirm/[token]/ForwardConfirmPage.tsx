'use client'

import { Button } from '@styleguide'
import {
  EmailPublicCard,
  EmailPublicLoading,
  InvalidLinkCard,
} from '../../EmailPublicCard'
import { useConfirmForward, useForwardConfirmState } from '../../emailPublicApi'

export const ForwardConfirmPage = ({ token }: { token: string }) => {
  const state = useForwardConfirmState(token)
  const confirm = useConfirmForward(token)

  if (state.isPending) return <EmailPublicLoading />
  if (state.isError || !state.data) return <InvalidLinkCard />

  const { senderName, forwardToEmail } = state.data

  if (confirm.isSuccess) {
    return (
      <EmailPublicCard
        title="Replies will go to this address."
        caption={`Replies to ${senderName} now arrive at ${confirm.data.forwardToEmail}.`}
      />
    )
  }

  return (
    <EmailPublicCard
      title={`Send replies to ${forwardToEmail}?`}
      caption={`Replies to email from ${senderName} will be forwarded here.`}
    >
      {confirm.isError && (
        <p role="alert" className="text-sm text-destructive">
          This link isn&apos;t valid anymore, or something went wrong. Try the
          link in your email again.
        </p>
      )}
      <Button
        type="button"
        loading={confirm.isPending}
        onClick={() => confirm.mutate()}
      >
        Confirm
      </Button>
    </EmailPublicCard>
  )
}
