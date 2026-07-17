'use client'
import { ReactNode, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Button,
  Input,
  Label,
  Textarea,
  ToggleGroup,
  ToggleGroupItem,
} from '@styleguide'
import {
  DoorOpenIcon,
  MessageSquareMoreIcon,
  PhoneIcon,
} from '@styleguide/components/ui/icons'
import { format } from 'date-fns'
import { clientRequest } from 'gpApi/typed-request'
import { useOrganization } from '@shared/organization-picker'
import { EVENTS, trackEvent } from 'helpers/analyticsHelper'
import { useCrmEnabled } from '../../../shared/useCrmEnabled'
import { useWinVoterContext } from '../../../shared/useWinVoterContext'
import { InfoSection } from './InfoSection'
import type { LogContactInteractionInput } from '../shared/contacts-types'

// Mirrors LogContactInteraction.schema's NoteSchema.max(10_000).
const NOTE_MAX_LENGTH = 10_000

type Channel = LogContactInteractionInput['channel']

// Sentinel for "no outcome recorded" on text, distinct from an unselected
// toggle — the locked vocabulary presents it as its own choosable option
// (per the CRM brief: "SMS responded / no outcome"), not a blank state.
const NO_OUTCOME = 'none'

const CHANNEL_OPTIONS: { value: Channel; label: string; icon: ReactNode }[] = [
  { value: 'text', label: 'Text', icon: <MessageSquareMoreIcon size={16} /> },
  {
    value: 'doorKnock',
    label: 'Door Knock',
    icon: <DoorOpenIcon size={16} />,
  },
  { value: 'robocall', label: 'Robocall', icon: <PhoneIcon size={16} /> },
]

const TEXT_OUTCOME_OPTIONS = [
  { value: NO_OUTCOME, label: 'No Outcome' },
  { value: 'responded', label: 'Responded' },
] as const

// opted_out is a valid API outcome for text but is normally system-recorded
// (the outreach unsubscribe path) — kept out of the manual form per the CRM
// brief's open question, resolved to exclude it here.
const DOOR_KNOCK_OUTCOME_OPTIONS = [
  { value: 'answered', label: 'Answered' },
  { value: 'not_home', label: 'Not Home' },
  { value: 'refused_to_engage', label: 'Refused to Engage' },
] as const

const ROBOCALL_OUTCOME_OPTIONS = [
  { value: 'answered', label: 'Answered' },
  { value: 'voicemail_left', label: 'Voicemail Left' },
] as const

const SUPPORT_ANSWER_OPTIONS = [
  { value: 'supporter', label: 'Yes' },
  { value: 'unsure', label: 'Unsure' },
  { value: 'non_supporter', label: 'No' },
] as const

const outcomeOptionsForChannel = (channel: Channel) => {
  if (channel === 'doorKnock') return DOOR_KNOCK_OUTCOME_OPTIONS
  if (channel === 'robocall') return ROBOCALL_OUTCOME_OPTIONS
  return TEXT_OUTCOME_OPTIONS
}

// `${dateStr}T12:00:00` has no timezone offset, so JS parses it as local
// noon rather than UTC midnight — the date input's `max` (today) plus this
// helper only ever running on a date strictly before today (see
// occurredAtInput handling below) keeps the result safely in the past, which
// LogContactInteractionInputSchema's occurredAt refine requires. The schema
// infers `occurredAt` as `Date` (z.coerce.date()'s output type); ofetch's
// JSON body serialization converts it back to an ISO string on the wire,
// which the server coerces back into a Date.
const toNoonDate = (dateStr: string): Date => new Date(`${dateStr}T12:00:00`)

interface LogInteractionProps {
  personId: string
}

export default function LogInteraction({
  personId,
}: LogInteractionProps): React.JSX.Element | null {
  // trackExposure=false: mirrors NotesSection — this surface reads the flag
  // to decide whether to render, it isn't the CRM treatment surface.
  const { enabled, ready } = useCrmEnabled()
  const orgSlug = useOrganization()?.slug
  const { isWin, isReady: isWinContextReady } = useWinVoterContext()
  const queryClient = useQueryClient()

  const [todayInputValue] = useState(() => format(new Date(), 'yyyy-MM-dd'))
  const [channel, setChannel] = useState<Channel | ''>('')
  const [outcome, setOutcome] = useState('')
  const [supportAnswer, setSupportAnswer] = useState('')
  const [note, setNote] = useState('')
  const [occurredAtInput, setOccurredAtInput] = useState(todayInputValue)

  const shouldRender = ready && enabled

  const logMutation = useMutation({
    mutationFn: (input: LogContactInteractionInput) =>
      clientRequest('POST /v1/contacts/:personId/interactions', {
        personId,
        ...input,
      }),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({
        queryKey: ['contact-engagement', 'activities'],
      })
      // supportStatus is derived on the person-detail response — refetch it
      // so a door-knock support answer shows up without a page reload.
      queryClient.invalidateQueries({
        queryKey: ['person', orgSlug, personId],
      })
      setChannel('')
      setOutcome('')
      setSupportAnswer('')
      setNote('')
      setOccurredAtInput(todayInputValue)
      if (isWinContextReady) {
        trackEvent(
          isWin
            ? EVENTS.VoterData.ContactLogged
            : EVENTS.ConstituentData.ContactLogged,
          {
            channel: variables.channel,
            outcome: variables.outcome ?? null,
            ...(variables.channel === 'doorKnock'
              ? { supportAnswer: variables.supportAnswer ?? null }
              : {}),
          },
        )
      }
    },
  })

  if (!shouldRender) return null

  const handleChannelChange = (value: string) => {
    const next = value as Channel | ''
    setChannel(next)
    setOutcome(next === 'text' ? NO_OUTCOME : '')
    setSupportAnswer('')
    logMutation.reset()
  }

  const isFormValid = channel !== '' && (channel === 'text' || outcome !== '')

  const buildPayload = (ch: Channel): LogContactInteractionInput => {
    const notePayload = note.trim() ? note.trim() : undefined
    // A native date input can be cleared to '' via the keyboard/browser UI
    // (not just left at the default) — `new Date('T12:00:00')` from an empty
    // string is an Invalid Date, which JSON.stringify silently renders as
    // `null` (Date.prototype.toJSON doesn't throw), and the server would
    // coerce that to the 1970 epoch rather than reject it. Treat '' the same
    // as "unchanged": omit occurredAt so the server defaults to now.
    const occurredAtPayload =
      occurredAtInput === todayInputValue || occurredAtInput === ''
        ? undefined
        : toNoonDate(occurredAtInput)

    if (ch === 'doorKnock') {
      return {
        channel: 'doorKnock',
        outcome:
          outcome as (typeof DOOR_KNOCK_OUTCOME_OPTIONS)[number]['value'],
        supportAnswer: supportAnswer
          ? (supportAnswer as (typeof SUPPORT_ANSWER_OPTIONS)[number]['value'])
          : undefined,
        note: notePayload,
        occurredAt: occurredAtPayload,
      }
    }
    if (ch === 'robocall') {
      return {
        channel: 'robocall',
        outcome: outcome as (typeof ROBOCALL_OUTCOME_OPTIONS)[number]['value'],
        note: notePayload,
        occurredAt: occurredAtPayload,
      }
    }
    return {
      channel: 'text',
      // Radix ToggleGroup deselect emits '' — only an explicit 'responded'
      // selection may persist a responded outcome.
      outcome: outcome === 'responded' ? 'responded' : undefined,
      note: notePayload,
      occurredAt: occurredAtPayload,
    }
  }

  const handleSubmit = () => {
    // isFormValid's `channel !== ''` conjunct already narrows `channel` here
    // (TS's control-flow analysis of aliased conditions) — no separate
    // `channel === ''` check needed.
    if (!isFormValid) return
    logMutation.mutate(buildPayload(channel))
  }

  return (
    <InfoSection title="Log an Interaction" icon={<PhoneIcon size={24} />}>
      <div className="flex flex-col gap-2">
        <Label>Channel</Label>
        <ToggleGroup
          type="single"
          variant="outline"
          value={channel}
          onValueChange={handleChannelChange}
          aria-label="Channel"
        >
          {CHANNEL_OPTIONS.map((opt) => (
            <ToggleGroupItem
              key={opt.value}
              value={opt.value}
              aria-label={opt.label}
              className="gap-1.5"
            >
              {opt.icon}
              {opt.label}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </div>

      {channel !== '' ? (
        <div className="flex flex-col gap-2">
          <Label>Outcome</Label>
          <ToggleGroup
            type="single"
            variant="outline"
            value={outcome}
            onValueChange={setOutcome}
            aria-label="Outcome"
          >
            {outcomeOptionsForChannel(channel).map((opt) => (
              <ToggleGroupItem key={opt.value} value={opt.value}>
                {opt.label}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </div>
      ) : null}

      {channel === 'doorKnock' ? (
        <div className="flex flex-col gap-2">
          <Label>Support</Label>
          <ToggleGroup
            type="single"
            variant="outline"
            value={supportAnswer}
            onValueChange={setSupportAnswer}
            aria-label="Support answer"
          >
            {SUPPORT_ANSWER_OPTIONS.map((opt) => (
              <ToggleGroupItem key={opt.value} value={opt.value}>
                {opt.label}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </div>
      ) : null}

      <div className="flex flex-col gap-2">
        <Label htmlFor="log-interaction-date">Date</Label>
        <Input
          id="log-interaction-date"
          type="date"
          value={occurredAtInput}
          max={todayInputValue}
          onChange={(e) => setOccurredAtInput(e.target.value)}
          className="w-fit"
        />
      </div>

      <Textarea
        value={note}
        onChange={(e) => setNote(e.target.value)}
        maxLength={NOTE_MAX_LENGTH}
        placeholder="Optional note"
        aria-label="Interaction note"
      />

      {logMutation.isError ? (
        <p className="text-sm text-destructive">
          Couldn&apos;t log this interaction. Please try again.
        </p>
      ) : null}

      <Button
        type="button"
        onClick={handleSubmit}
        disabled={!isFormValid || logMutation.isPending}
        loading={logMutation.isPending}
        className="self-start"
      >
        Log Interaction
      </Button>
    </InfoSection>
  )
}
