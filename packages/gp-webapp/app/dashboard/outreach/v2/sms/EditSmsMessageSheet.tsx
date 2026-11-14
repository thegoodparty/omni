import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { FetchError } from 'ofetch'
import {
  checkSmsStandards,
  findSmsRestrictedWords,
  SMS_COMPOSED_MAX_LENGTH,
  type OutreachDetail,
} from '@goodparty_org/contracts'
import { Button } from '@styleguide'
import { Loader2Icon } from '@styleguide/components/ui/icons'
import { clientRequest } from 'gpApi/typed-request'
import { EVENTS, trackEvent } from 'helpers/analyticsHelper'
import { useCampaign } from '@shared/hooks/useCampaign'
import { ListDetailsSheetShell } from '../listDetails/ListDetailsSheetShell'
import { SmsComposeStep, type SmsRequiredPart } from './SmsComposeStep'
import { SmsPreviewStep } from './SmsPreviewStep'
import {
  addGreetingBack,
  addIdentificationBack,
  addOptOutBack,
  addPaidForByBack,
  composeScript,
  identificationIntro,
  unfilledBrackets,
  withSampleFirstName,
} from './smsCompose.util'

interface EditSmsMessageSheetProps {
  outreachId: number
  script: string
  imageUrl: string | null
  onClose: () => void
  onSaved: (detail: OutreachDetail) => void
  // The route answers 409 once staff have approved or booked the text.
  onLocked: () => void
}

// The committee the saved script already names. The drawer has no
// verification record to read it from, and the script is the one place the
// line the candidate must keep is spelled out.
const savedCommitteeOf = (script: string): string | null =>
  script.match(/Paid for by (.+?)\.(?=\s+Reply\b|\s*$)/im)?.[1]?.trim() ?? null

export const EditSmsMessageSheet = ({
  outreachId,
  script,
  imageUrl,
  onClose,
  onSaved,
  onLocked,
}: EditSmsMessageSheetProps) => {
  const [campaign] = useCampaign()
  const [message, setMessage] = useState(script)
  const [step, setStep] = useState<'compose' | 'preview'>('compose')
  const [continueAttempts, setContinueAttempts] = useState(0)

  const candidateName = campaign?.ownerName ?? ''
  const committee = savedCommitteeOf(script)
  const paidForByFailed = (text: string) =>
    checkSmsStandards(text, { committeeName: committee }).failures.includes(
      'paid_for_by',
    )
  const savedLacksPaidForBy = paidForByFailed(script)
  const paidForByRemoved = !savedLacksPaidForBy && paidForByFailed(message)
  const standardsFailures = checkSmsStandards(message, {
    candidateNames: candidateName ? [candidateName] : [],
  }).failures.filter((rule) => !(rule === 'paid_for_by' && savedLacksPaidForBy))
  const brackets = unfilledBrackets(message)
  const intro = identificationIntro(
    'warm',
    candidateName,
    campaign?.positionName || campaign?.details?.normalizedOffice || '',
  )
  const canContinue =
    message.trim() !== '' &&
    !paidForByRemoved &&
    standardsFailures.length === 0 &&
    brackets.length === 0 &&
    message.length <= SMS_COMPOSED_MAX_LENGTH

  const saveMutation = useMutation({
    mutationFn: () =>
      clientRequest('PATCH /v1/outreach/:id/sms/script', {
        id: String(outreachId),
        script: message,
      }),
    onSuccess: ({ data }) => {
      trackEvent(EVENTS.Outreach.SmsMessageUpdated, {
        product: 'win',
        lengthBefore: script.length,
        lengthAfter: message.length,
      })
      onSaved(data)
    },
    onError: (error) => {
      if (error instanceof FetchError && error.status === 409) onLocked()
    },
  })

  const handleAddRequiredBack = (rule: SmsRequiredPart) => {
    const [greeting = ''] = composeScript('', null).split('\n\n')
    const next =
      rule === 'opt_out_line'
        ? addOptOutBack(message)
        : rule === 'first_name_token'
          ? addGreetingBack(message, greeting)
          : rule === 'candidate_name'
            ? addIdentificationBack(message, { greeting, intro })
            : rule === 'paid_for_by' && committee
              ? addPaidForByBack(message, committee)
              : message
    setMessage(next)
  }

  const handleContinue = () => {
    if (!canContinue) {
      setContinueAttempts((attempts) => attempts + 1)
      return
    }
    setStep('preview')
  }

  return (
    <ListDetailsSheetShell
      open
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
      title="Edit your message"
      header={
        <h2 className="text-[22px] font-semibold text-foreground">
          Edit your message
        </h2>
      }
      footer={
        <div className="shrink-0 border-t border-border bg-background px-4 py-4 lg:px-6">
          <div className="mx-auto flex w-full max-w-[608px] flex-col gap-3">
            {saveMutation.isError && (
              <p className="text-sm text-destructive" role="alert">
                We couldn&apos;t save your message. Try again.
              </p>
            )}
            {paidForByRemoved && (
              <p className="text-sm text-destructive" role="alert">
                Keep the &quot;Paid for by&quot; line in your message.
              </p>
            )}
            {step === 'compose' ? (
              <Button
                size="large"
                className="w-full"
                disabled={paidForByRemoved}
                onClick={handleContinue}
              >
                Continue
              </Button>
            ) : (
              <Button
                size="large"
                className="w-full"
                disabled={saveMutation.isPending || paidForByRemoved}
                onClick={() => saveMutation.mutate()}
              >
                {saveMutation.isPending && (
                  <Loader2Icon className="size-4 animate-spin" />
                )}
                Save message
              </Button>
            )}
          </div>
        </div>
      }
    >
      {step === 'compose' ? (
        <SmsComposeStep
          mode="edit"
          isServe={false}
          tone="warm"
          onToneChange={() => undefined}
          standardsFailures={standardsFailures}
          restrictedWords={findSmsRestrictedWords(message)}
          unfilledBrackets={brackets}
          identificationExample={intro}
          paidForByText={committee ? `Paid for by ${committee}.` : null}
          onAddRequiredBack={handleAddRequiredBack}
          message={message}
          onMessageChange={setMessage}
          mergeTagChannel="peerly"
          hasWrittenBody={message.trim() !== ''}
          composedLength={message.length}
          aiAction="improve"
          onAiAction={() => undefined}
          isDrafting={false}
          isDraftError={false}
          canUndo={false}
          onUndo={() => undefined}
          imagePreviewUrl={imageUrl}
          onImageChange={() => undefined}
          imageError={null}
          onImageError={() => undefined}
          continueAttempts={continueAttempts}
        />
      ) : (
        <SmsPreviewStep
          mode="edit"
          script={withSampleFirstName(message)}
          imageUrl={imageUrl}
          onEdit={() => setStep('compose')}
        />
      )}
    </ListDetailsSheetShell>
  )
}
