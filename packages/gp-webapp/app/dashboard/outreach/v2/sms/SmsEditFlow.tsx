'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { format } from 'date-fns'
import { useMutation } from '@tanstack/react-query'
import type { SmsDraftRequest, SocialTone } from '@goodparty_org/contracts'
import { SMS_COMPOSED_MAX_LENGTH } from '@goodparty_org/contracts'
import { Button, Card } from '@styleguide'
import {
  CircleCheckIcon,
  MessageSquareIcon,
} from '@styleguide/components/ui/icons'
import { clientRequest } from 'gpApi/typed-request'
import { updateOutreach } from 'gpApi/outreach.api'
import { useCampaign } from '@shared/hooks/useCampaign'
import { useUser } from '@shared/hooks/useUser'
import {
  OUTREACH_OPTIONS,
  OUTREACH_TYPES,
} from 'app/dashboard/outreach/constants'
import { ChannelBadge } from '../channelMeta'
import { OutreachFlowShell, type FlowShellCta } from '../OutreachFlowShell'
import { SmsScheduleStep, TIME_OPTIONS } from './SmsScheduleStep'
import { SmsComposeStep } from './SmsComposeStep'
import {
  composeScript,
  hasIdentification,
  identificationIntro,
  stripComposedScript,
} from './smsCompose.util'

// What the edit sheet needs from the drawer's detail read. Audience and
// price are deliberately absent — they're frozen at checkout, which is why
// this flow has no audience step (and no Back off its first step).
export interface SmsEditTarget {
  id: number
  name: string
  date: Date
  script: string
  imageUrl: string | null
  contactCount: number
  audienceName: string | null
}

type StepId = 'schedule' | 'compose' | 'review'
const STEP_ORDER: StepId[] = ['schedule', 'compose', 'review']

const STEP_TITLES: Record<StepId, string> = {
  schedule: 'When do you want to send?',
  compose: 'What do you want to say?',
  review: 'Review changes',
}

const PRICE_PER_MESSAGE =
  OUTREACH_OPTIONS.find((o) => o.type === OUTREACH_TYPES.text)?.cost ?? 0.035

const fmtDate = (d: Date) =>
  d.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })

const fmtTime = (d: Date) =>
  d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })

interface SmsEditFlowProps {
  open: boolean
  target: SmsEditTarget | null
  onClose: () => void
  // Fired after a successful save with the edited row's id; the hub
  // invalidates that detail cache and refetches the outreach list.
  onSaved: (id: number) => Promise<void>
}

export const SmsEditFlow = ({
  open,
  target,
  onClose,
  onSaved,
}: SmsEditFlowProps) => {
  const [campaign] = useCampaign()
  const [user] = useUser()

  const [stepId, setStepId] = useState<StepId>('schedule')
  const [name, setName] = useState('')
  const [date, setDate] = useState<Date | undefined>(undefined)
  const [timeSlot, setTimeSlot] = useState('10')
  const [customTime, setCustomTime] = useState('10:00')

  const [tone, setTone] = useState<SocialTone>('warm')
  const [body, setBody] = useState('')
  const [undoText, setUndoText] = useState<string | null>(null)

  // A replacement image is a File; the stored one only exists as a URL.
  // Clearing both is what disables Continue until a new file is attached.
  const [newImage, setNewImage] = useState<File | null>(null)
  const [existingImageUrl, setExistingImageUrl] = useState<string | null>(null)
  const [newImagePreviewUrl, setNewImagePreviewUrl] = useState<string | null>(
    null,
  )
  const [imageError, setImageError] = useState<string | null>(null)

  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState(false)
  const [saved, setSaved] = useState(false)

  const initialRef = useRef<{ name: string; body: string; at: number } | null>(
    null,
  )

  useEffect(() => {
    if (!open || !target) return
    setStepId('schedule')
    setName(target.name)
    const at = new Date(target.date)
    setDate(new Date(at.getFullYear(), at.getMonth(), at.getDate()))
    const timeStr = format(at, 'HH:mm')
    const slot = TIME_OPTIONS.find((t) => t.time === timeStr)
    if (slot) {
      setTimeSlot(slot.id)
      setCustomTime('10:00')
    } else {
      setTimeSlot('custom')
      setCustomTime(timeStr)
    }
    const initialBody = stripComposedScript(target.script)
    setTone('warm')
    setBody(initialBody)
    setUndoText(null)
    setNewImage(null)
    setExistingImageUrl(target.imageUrl)
    setImageError(null)
    setSaving(false)
    setSaveError(false)
    setSaved(false)
    initialRef.current = {
      name: target.name,
      body: initialBody,
      at: at.getTime(),
    }
  }, [open, target])

  useEffect(() => {
    if (!newImage) {
      setNewImagePreviewUrl(null)
      return
    }
    const url = URL.createObjectURL(newImage)
    setNewImagePreviewUrl(url)
    return () => URL.revokeObjectURL(url)
  }, [newImage])

  const composedMessage = composeScript(body)
  const composedLength = composedMessage.length
  const missingIdentification = !hasIdentification(body, user?.firstName ?? '')
  const identificationExample = identificationIntro(
    tone,
    user?.firstName ?? '',
    campaign?.details?.normalizedOffice ?? '',
  )

  // Same floor as scheduling: inside 48 hours of send, a campaign is too
  // close to its Peerly window to change — the schedule step surfaces it.
  const earliestSend = useMemo(
    () => Date.now() + 48 * 60 * 60 * 1000,
    // eslint-disable-next-line react-hooks/exhaustive-deps -- recompute per open
    [open],
  )

  const scheduledAt = useMemo(() => {
    if (!date) return null
    const slot = TIME_OPTIONS.find((t) => t.id === timeSlot)
    const timeStr = timeSlot === 'custom' ? customTime : slot?.time
    if (!timeStr) return null
    const [hh, mm] = timeStr.split(':').map(Number)
    if (hh === undefined || mm === undefined || Number.isNaN(hh)) return null
    const d = new Date(date)
    d.setHours(hh, mm, 0, 0)
    return d
  }, [date, timeSlot, customTime])

  const violates48h = scheduledAt ? scheduledAt.getTime() < earliestSend : false
  const outsideWindow = scheduledAt
    ? scheduledAt.getHours() < 9 ||
      scheduledAt.getHours() > 21 ||
      (scheduledAt.getHours() === 21 && scheduledAt.getMinutes() > 0)
    : false

  // Improve-only compose: there is no purpose on a stored campaign, so the
  // draft endpoint runs in its custom mode (polish the current message).
  const draftMutation = useMutation({
    mutationFn: async (input: SmsDraftRequest) => {
      const { data } = await clientRequest('POST /v1/outreach/sms/draft', input)
      return data.draft
    },
  })
  const { reset: resetDraftMutation } = draftMutation

  const handleImprove = () => {
    if (body.trim().length === 0) return
    const prior = body
    draftMutation.mutate(
      { purpose: 'custom', tone, currentDraft: body },
      {
        onSuccess: (generated) => {
          setUndoText(prior)
          setBody(generated)
        },
      },
    )
  }

  const handleUndo = () => {
    if (undoText === null) return
    setBody(undoText)
    setUndoText(null)
  }

  const handleSave = async () => {
    if (!target || !scheduledAt || saving) return
    setSaving(true)
    setSaveError(false)
    const resp = await updateOutreach(
      target.id,
      {
        name: name.trim(),
        script: composedMessage,
        // Offset-annotated local time: the server slices the first 10 chars
        // as the user's send DAY for Peerly (same contract as create).
        date: format(scheduledAt, "yyyy-MM-dd'T'HH:mm:ssXXX"),
      },
      newImage,
    )
    setSaving(false)
    if (!resp?.ok) {
      setSaveError(true)
      return
    }
    setSaved(true)
    await onSaved(target.id)
  }

  const stepIndex = STEP_ORDER.indexOf(stepId)
  const handleBack = () => {
    const previous = STEP_ORDER[stepIndex - 1]
    if (previous) setStepId(previous)
  }

  const initial = initialRef.current
  const dirty =
    !saved &&
    initial !== null &&
    (name !== initial.name ||
      body !== initial.body ||
      (scheduledAt !== null && scheduledAt.getTime() !== initial.at) ||
      newImage !== null ||
      existingImageUrl === null)

  const hasImage = newImage !== null || existingImageUrl !== null

  const cta: FlowShellCta | null = saved
    ? null
    : stepId === 'schedule'
      ? {
          label: 'Continue',
          onClick: () => setStepId('compose'),
          disabled:
            name.trim().length === 0 ||
            scheduledAt === null ||
            violates48h ||
            outsideWindow,
        }
      : stepId === 'compose'
        ? {
            label: 'Continue',
            onClick: () => setStepId('review'),
            disabled:
              body.trim().length === 0 ||
              missingIdentification ||
              composedLength > SMS_COMPOSED_MAX_LENGTH ||
              !hasImage ||
              draftMutation.isPending,
          }
        : {
            label: saveError ? 'Try again' : 'Save changes',
            onClick: () => {
              void handleSave()
            },
            loading: saving,
          }

  return (
    <OutreachFlowShell
      open={open}
      onClose={onClose}
      title={saved ? 'Done' : STEP_TITLES[stepId]}
      headerBadge={<ChannelBadge type="text" />}
      currentStep={stepIndex + 1}
      totalSteps={saved ? 0 : STEP_ORDER.length}
      onBack={!saved && stepIndex > 0 ? handleBack : undefined}
      cta={cta}
      dirty={dirty}
    >
      {saved ? (
        <div className="space-y-6 py-8 text-center">
          <div className="flex justify-center">
            <span className="flex size-16 items-center justify-center rounded-full bg-primary-light">
              <CircleCheckIcon className="size-8 text-primary" />
            </span>
          </div>
          <div className="space-y-2">
            <h2 className="text-2xl font-semibold text-foreground">
              Changes saved
            </h2>
            <p className="text-muted-foreground">
              Your sms campaign will reach{' '}
              {(target?.contactCount ?? 0).toLocaleString()} recipients
              {scheduledAt
                ? ` starting ${fmtDate(scheduledAt)} at ${fmtTime(scheduledAt)}.`
                : ' soon.'}
            </p>
          </div>
          <Button type="button" size="large" onClick={onClose}>
            Done
          </Button>
        </div>
      ) : stepId === 'schedule' ? (
        <SmsScheduleStep
          name={name}
          onNameChange={setName}
          date={date}
          onDateChange={setDate}
          timeSlot={timeSlot}
          onTimeSlotChange={setTimeSlot}
          customTime={customTime}
          onCustomTimeChange={setCustomTime}
          earliestSend={earliestSend}
          calendarFloor={earliestSend}
          violates48h={violates48h}
          outsideWindow={outsideWindow}
        />
      ) : stepId === 'compose' ? (
        <SmsComposeStep
          tone={tone}
          onToneChange={setTone}
          audienceName={target?.audienceName ?? ''}
          standardsFailures={missingIdentification ? ['candidate_name'] : []}
          identificationExample={identificationExample}
          committeeName={null}
          body={body}
          onBodyChange={(value) => {
            setBody(value)
            if (draftMutation.isError) resetDraftMutation()
          }}
          composedLength={composedLength}
          // Never invoked: isCustomPurpose hides the regenerate control (a
          // stored campaign has no purpose to regenerate from).
          onRegenerate={() => undefined}
          onImprove={handleImprove}
          canImprove={body.trim().length > 0}
          isDrafting={draftMutation.isPending}
          isDraftError={draftMutation.isError}
          canUndo={undoText !== null}
          onUndo={handleUndo}
          isCustomPurpose
          image={newImage}
          imagePreviewUrl={newImagePreviewUrl ?? existingImageUrl}
          onImageChange={(file) => {
            setNewImage(file)
            if (file === null) setExistingImageUrl(null)
          }}
          imageError={imageError}
          onImageError={setImageError}
        />
      ) : (
        <div className="space-y-6">
          <Card className="gap-0 overflow-hidden p-0">
            <div className="flex items-center gap-3 px-4 py-4">
              <span className="flex size-12 shrink-0 items-center justify-center rounded-full bg-info-light">
                <MessageSquareIcon className="size-6 text-foreground" />
              </span>
              <div className="min-w-0">
                <p className="font-medium text-foreground">SMS</p>
                <p className="truncate text-sm text-muted-foreground">{name}</p>
              </div>
            </div>
            <div className="border-t border-border px-4 py-4">
              <dl className="space-y-1.5 text-sm">
                <div className="flex justify-between gap-4">
                  <dt className="text-muted-foreground">Send date</dt>
                  <dd className="text-foreground">
                    {scheduledAt ? fmtDate(scheduledAt) : '—'}
                  </dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt className="text-muted-foreground">Send time</dt>
                  <dd className="text-foreground">
                    {scheduledAt ? fmtTime(scheduledAt) : '—'}
                  </dd>
                </div>
                {target?.audienceName && (
                  <div className="flex justify-between gap-4">
                    <dt className="text-muted-foreground">Audience</dt>
                    <dd className="truncate text-foreground">
                      {target.audienceName}
                    </dd>
                  </div>
                )}
                <div className="flex justify-between gap-4">
                  <dt className="text-muted-foreground">People</dt>
                  <dd className="text-foreground">
                    {(target?.contactCount ?? 0).toLocaleString()}
                  </dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt className="text-muted-foreground">Price per outreach</dt>
                  <dd className="text-foreground">
                    ${PRICE_PER_MESSAGE.toFixed(3)}
                  </dd>
                </div>
              </dl>
            </div>
            <div className="flex items-center justify-between border-t border-border px-4 py-4">
              <span className="font-medium text-foreground">Total</span>
              <span className="text-sm text-muted-foreground">
                Already paid — the audience doesn&apos;t change, so neither does
                the price.
              </span>
            </div>
          </Card>

          <div className="flex justify-center">
            <div className="w-full max-w-[280px] rounded-2xl rounded-bl-sm bg-primary p-3 text-sm text-primary-foreground">
              {(newImagePreviewUrl ?? existingImageUrl) && (
                /* eslint-disable-next-line @next/next/no-img-element -- local
                   object URL / stored asset preview */
                <img
                  src={newImagePreviewUrl ?? existingImageUrl ?? undefined}
                  alt="Attached"
                  className="mb-2 max-h-48 w-full rounded-xl object-cover"
                />
              )}
              <p className="whitespace-pre-wrap">{composedMessage}</p>
            </div>
          </div>

          {saveError && (
            <p className="text-center text-sm text-destructive">
              We couldn&apos;t save your changes. Try again.
            </p>
          )}
        </div>
      )}
    </OutreachFlowShell>
  )
}
