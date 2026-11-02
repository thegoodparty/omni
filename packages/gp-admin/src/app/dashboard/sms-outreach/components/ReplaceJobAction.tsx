'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import * as Sentry from '@sentry/nextjs'
import {
  AlertDialog,
  Box,
  Button,
  Callout,
  Flex,
  RadioGroup,
  SegmentedControl,
  Text,
  TextField,
} from '@radix-ui/themes'
import {
  SMS_JOB_REPLACE_REASON_LABELS,
  type SmsJobReplaceReason,
} from '@goodparty_org/contracts'
import { useToast } from '@/components/Toast'
import { formatLocalSendTime } from '@/lib/utils/date'
import { describeActionFailure } from '@/shared/util/actionFailure.util'
import { linkSmsJob, replaceSmsJob } from '../actions'
import { etParts, etToInstant } from './etDateTime'

type Mode = 'replace' | 'link'
type Step = 'choose' | 'confirm'

const REASONS = Object.entries(SMS_JOB_REPLACE_REASON_LABELS) as [
  SmsJobReplaceReason,
  string,
][]

interface ReplaceJobActionProps {
  id: number
  jobId: string
  sendAt: string | null
  scheduledLocalTime: string | null
  // A sent job can't be canceled; its replacement can only be linked.
  alreadySent: boolean
  canvassersBooked: boolean
}

export function ReplaceJobAction({
  id,
  jobId,
  sendAt,
  scheduledLocalTime,
  alreadySent,
  canvassersBooked,
}: ReplaceJobActionProps) {
  const router = useRouter()
  const { showToast } = useToast()
  const [open, setOpen] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  // router.refresh() returns no promise, so a transition is the only way to
  // know the re-render with the new job's data has landed.
  const [isRefreshing, startTransition] = useTransition()
  const busy = submitting || isRefreshing
  const defaultMode: Mode = alreadySent ? 'link' : 'replace'
  const [step, setStep] = useState<Step>('choose')
  const [mode, setMode] = useState<Mode>(defaultMode)
  const [dateDraft, setDateDraft] = useState('')
  const [newJobId, setNewJobId] = useState('')
  const [reason, setReason] = useState<SmsJobReplaceReason | ''>('')
  const [otherReason, setOtherReason] = useState('')
  const [failure, setFailure] = useState<string | null>(null)

  const etTime = sendAt ? etParts(new Date(sendAt)).time : '09:00'
  const reasonText =
    reason === 'other'
      ? otherReason.trim()
      : reason
        ? SMS_JOB_REPLACE_REASON_LABELS[reason]
        : ''
  const ready =
    reasonText !== '' &&
    (mode === 'replace' ? dateDraft !== '' : newJobId.trim() !== '')

  function handleReview() {
    if (!ready) return
    if (
      mode === 'replace' &&
      etToInstant(dateDraft, etTime).getTime() <= Date.now()
    ) {
      setFailure('Pick a send date in the future')
      return
    }
    setFailure(null)
    setStep('confirm')
  }

  async function handleConfirm() {
    if (!ready || reason === '') return
    const reasonFields = {
      currentJobId: jobId,
      reason,
      ...(reason === 'other' && { otherReason: otherReason.trim() }),
    }
    setSubmitting(true)
    setFailure(null)
    try {
      const { error } =
        mode === 'replace'
          ? await replaceSmsJob(id, {
              ...reasonFields,
              sendAt: etToInstant(dateDraft, etTime).toISOString(),
              scheduledLocalDate: dateDraft,
            })
          : await linkSmsJob(id, { ...reasonFields, jobId: newJobId.trim() })
      if (error) {
        setFailure(error)
        return
      }
      showToast(
        mode === 'replace'
          ? 'Job replaced. Approve it to book canvassers on the new job.'
          : 'Linked. The console now follows the Peerly job you made.'
      )
      setOpen(false)
      startTransition(() => router.refresh())
    } catch (error) {
      // A rejection here never reached gp-api (deploy skew, expired session),
      // so this catch is the failure's only trace anywhere. Report it.
      Sentry.captureException(error)
      setFailure(describeActionFailure(error, 'Failed to replace the job'))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <AlertDialog.Root
      open={open}
      onOpenChange={(next) => {
        if (busy) return
        setOpen(next)
        setFailure(null)
        if (next) {
          setStep('choose')
          setMode(defaultMode)
          setDateDraft('')
          setNewJobId('')
          setReason('')
          setOtherReason('')
        }
      }}
    >
      <AlertDialog.Trigger>
        <Button variant="outline" disabled={busy} loading={busy}>
          Replace Peerly job
        </Button>
      </AlertDialog.Trigger>
      <AlertDialog.Content maxWidth="480px">
        {step === 'choose' ? (
          <>
            <AlertDialog.Title>Replace the Peerly job</AlertDialog.Title>
            <AlertDialog.Description size="2">
              For when Peerly needs this send on a new job, such as after a bad
              sending number.
            </AlertDialog.Description>

            {alreadySent ? (
              <Text size="2" as="p" mt="3">
                This send already went out, so its job can&apos;t be canceled.
                Link the job made in Peerly instead.
              </Text>
            ) : (
              <SegmentedControl.Root
                mt="3"
                value={mode}
                onValueChange={(value) => {
                  setMode(value as Mode)
                  setFailure(null)
                }}
              >
                <SegmentedControl.Item value="replace">
                  Replace job
                </SegmentedControl.Item>
                <SegmentedControl.Item value="link">
                  Link a job from Peerly
                </SegmentedControl.Item>
              </SegmentedControl.Root>
            )}

            {mode === 'replace' ? (
              <label>
                <Text size="1" color="gray" as="p" mt="3" mb="1">
                  New send date
                </Text>
                <TextField.Root
                  type="date"
                  value={dateDraft}
                  onChange={(event) => setDateDraft(event.target.value)}
                  disabled={busy}
                />
              </label>
            ) : (
              <label>
                <Text size="1" color="gray" as="p" mt="3" mb="1">
                  Peerly job id
                </Text>
                <TextField.Root
                  value={newJobId}
                  onChange={(event) => setNewJobId(event.target.value)}
                  disabled={busy}
                />
              </label>
            )}

            <Text size="1" color="gray" as="p" mt="3" mb="1">
              Reason
            </Text>
            <RadioGroup.Root
              value={reason}
              onValueChange={(value) => setReason(value as SmsJobReplaceReason)}
              aria-label="Reason"
            >
              {REASONS.map(([value, label]) => (
                <RadioGroup.Item key={value} value={value}>
                  {label}
                </RadioGroup.Item>
              ))}
            </RadioGroup.Root>
            {reason === 'other' && (
              <Box mt="2">
                <TextField.Root
                  aria-label="Other reason"
                  value={otherReason}
                  maxLength={500}
                  onChange={(event) => setOtherReason(event.target.value)}
                  disabled={busy}
                />
              </Box>
            )}
          </>
        ) : (
          <>
            <AlertDialog.Title>
              {mode === 'replace' ? 'Replace this job?' : 'Link this job?'}
            </AlertDialog.Title>
            <AlertDialog.Description size="2">
              Here is what will happen.
            </AlertDialog.Description>
            <Text as="div" size="2" mt="2">
              {mode === 'replace' ? (
                <ul className="list-disc pl-5">
                  <li>
                    Cancels Peerly job {jobId}
                    {canvassersBooked ? ' and its canvasser booking' : ''}.
                  </li>
                  <li>
                    Makes a new Peerly job with the same message, image and
                    list, sending{' '}
                    {formatLocalSendTime(dateDraft, scheduledLocalTime) ??
                      dateDraft}
                    .
                  </li>
                  <li>
                    The campaign goes back to awaiting review. Approve it to
                    book canvassers.
                  </li>
                  <li>The candidate is not charged again.</li>
                </ul>
              ) : (
                <ul className="list-disc pl-5">
                  <li>
                    Leaves Peerly job {jobId} as it is in Peerly. The console
                    stops following it.
                  </li>
                  <li>
                    Follows Peerly job {newJobId.trim()} instead. If canvassers
                    are booked on it, the campaign shows as booked.
                  </li>
                  <li>Nothing is made or canceled in Peerly.</li>
                  <li>The candidate is not charged again.</li>
                </ul>
              )}
            </Text>
            <Text size="2" as="p" mt="2">
              Reason: {reasonText}
            </Text>
          </>
        )}

        {failure && (
          <Callout.Root color="red" role="alert" mt="3">
            <Callout.Text>{failure}</Callout.Text>
          </Callout.Root>
        )}
        <Flex gap="3" mt="4" justify="end">
          {step === 'choose' ? (
            <>
              <AlertDialog.Cancel>
                <Button variant="soft" color="gray" disabled={busy}>
                  Cancel
                </Button>
              </AlertDialog.Cancel>
              <Button onClick={handleReview} disabled={busy || !ready}>
                Review
              </Button>
            </>
          ) : (
            <>
              <Button
                variant="soft"
                color="gray"
                onClick={() => {
                  setStep('choose')
                  setFailure(null)
                }}
                disabled={busy}
              >
                Back
              </Button>
              <AlertDialog.Action>
                <Button
                  onClick={(event) => {
                    event.preventDefault()
                    handleConfirm()
                  }}
                  disabled={busy}
                  loading={busy}
                >
                  {mode === 'replace' ? 'Replace job' : 'Link job'}
                </Button>
              </AlertDialog.Action>
            </>
          )}
        </Flex>
      </AlertDialog.Content>
    </AlertDialog.Root>
  )
}
