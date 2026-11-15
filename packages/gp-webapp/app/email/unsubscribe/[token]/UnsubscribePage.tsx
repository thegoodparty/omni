'use client'

import { useState } from 'react'
import { Button } from '@styleguide'
import {
  EmailPublicCard,
  EmailPublicLoading,
  InvalidLinkCard,
} from '../../EmailPublicCard'
import { useUnsubscribeAction, useUnsubscribeState } from '../../emailPublicApi'
import { unsubscribeCopy } from './unsubscribeCopy'

export const UnsubscribePage = ({ token }: { token: string }) => {
  const state = useUnsubscribeState(token)
  const unsubscribe = useUnsubscribeAction(token, 'unsubscribe')
  const undo = useUnsubscribeAction(token, 'undo')
  const [justUndone, setJustUndone] = useState(false)

  if (state.isPending) return <EmailPublicLoading />
  if (state.isError || !state.data) return <InvalidLinkCard />

  const { senderName, mode, unsubscribed } = state.data
  const copy = unsubscribeCopy(mode, senderName, unsubscribed, justUndone)
  const failed = unsubscribe.isError || undo.isError

  return (
    <EmailPublicCard title={copy.title} caption={copy.caption}>
      {failed && (
        <p role="alert" className="text-sm text-destructive">
          Something went wrong. Try again.
        </p>
      )}
      {unsubscribed ? (
        <Button
          type="button"
          variant="outline"
          loading={undo.isPending}
          onClick={() =>
            undo.mutate(undefined, { onSuccess: () => setJustUndone(true) })
          }
        >
          Undo
        </Button>
      ) : (
        <Button
          type="button"
          loading={unsubscribe.isPending}
          onClick={() => {
            setJustUndone(false)
            unsubscribe.mutate()
          }}
        >
          Unsubscribe
        </Button>
      )}
    </EmailPublicCard>
  )
}
