'use client'

import { useEffect, useRef, useState } from 'react'
import { formatInTimeZone } from 'date-fns-tz'
import { Card, IconButton } from '@styleguide'
import { PauseIcon, PlayIcon } from '@styleguide/components/ui/icons'
import { CHANNEL_META } from '../channelMeta'
import { Intro } from '../social/Intro'
import { type RobocallRecording } from './useRobocallRecorder'
import { timeZoneShortLabel } from './scheduleTimeZone'

const fmtDur = (secs: number): string =>
  `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`

const money = (n: number): string =>
  n.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })

interface RobocallReviewStepProps {
  campaignName: string
  audienceName: string
  // Landline-reachable count already resolved in the audience step, and the
  // per-contact robocall price the audience step charges against it — the
  // estimated cost is their product (no second price source).
  reachCount: number
  pricePerContact: number
  // The UTC send instant and the zone it was chosen in, so the summary reads
  // back the same wall-clock date/time the schedule step showed.
  scheduledAt: Date | null
  timeZone: string
  // The rented caller-ID number the candidate read aloud.
  callbackNumber: string | null
  // The saved clip (playback here) and the script it was read against.
  recording: RobocallRecording | null
  script: string
}

// The pre-send summary (after compose, before payment): reads back the
// audience, schedule, recording, caller-ID number and estimated cost so the
// candidate can confirm before the pay step (a sibling slice). Follows the
// design's shared flowReview summary-card anatomy; the recording playback +
// script use the compose step's design language since our flow records before
// this review.
export const RobocallReviewStep = ({
  campaignName,
  audienceName,
  reachCount,
  pricePerContact,
  scheduledAt,
  timeZone,
  callbackNumber,
  recording,
  script,
}: RobocallReviewStepProps) => {
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const [playing, setPlaying] = useState(false)

  // A swapped clip resets playback (the old audio element is gone).
  useEffect(() => setPlaying(false), [recording?.url])

  const togglePlay = () => {
    const el = audioRef.current
    if (!el) return
    if (el.paused) el.play().catch(() => setPlaying(false))
    else el.pause()
  }

  const dateStr = scheduledAt
    ? formatInTimeZone(scheduledAt, timeZone, 'EEE, MMM d, yyyy')
    : '—'
  const timeStr = scheduledAt
    ? `${formatInTimeZone(scheduledAt, timeZone, 'h:mm a')} ${timeZoneShortLabel(timeZone, scheduledAt)}`
    : '—'
  const estimatedCost = reachCount * pricePerContact

  const rows: [string, string][] = [
    ['Send date', dateStr],
    ['Send time', timeStr],
    ['Audience', audienceName],
    ['People', reachCount.toLocaleString()],
    ['Caller ID number', callbackNumber ?? '—'],
    ['Price per call', `$${pricePerContact.toFixed(3)}`],
  ]

  return (
    <div className="space-y-6">
      <Intro
        channel="robocall"
        title="Review your campaign"
        body="Check the details below, then continue to payment to schedule your calls."
      />

      <Card className="gap-0 overflow-hidden p-0">
        <div className="flex items-center gap-3 p-4">
          <span className="flex size-12 shrink-0 items-center justify-center rounded-full bg-warning/10 text-warning [&_svg]:size-6">
            {CHANNEL_META.robocall.icon}
          </span>
          <div className="min-w-0">
            <p className="font-medium text-foreground">
              {CHANNEL_META.robocall.label}
            </p>
            <p className="truncate text-sm text-muted-foreground">
              {campaignName || 'Untitled campaign'}
            </p>
          </div>
        </div>
        <div className="flex flex-col gap-1.5 border-t border-border p-4">
          {rows.map(([label, value]) => (
            <div key={label} className="flex justify-between gap-4 text-sm">
              <span className="text-muted-foreground">{label}</span>
              <span className="text-right text-foreground">{value}</span>
            </div>
          ))}
        </div>
        <div className="flex justify-between border-t border-border p-4">
          <span className="font-medium text-foreground">Estimated cost</span>
          <span className="font-semibold text-foreground">
            ${money(estimatedCost)}
          </span>
        </div>
      </Card>

      <Card className="gap-3 p-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Your recording
        </p>
        {recording && (
          <div className="flex items-center gap-3">
            <IconButton
              type="button"
              variant="default"
              size="large"
              aria-label={playing ? 'Pause' : 'Play'}
              onClick={togglePlay}
            >
              {playing ? (
                <PauseIcon className="size-5" />
              ) : (
                <PlayIcon className="size-5" />
              )}
            </IconButton>
            <p className="text-sm tabular-nums text-muted-foreground">
              {fmtDur(recording.durationSec)}
            </p>
            <audio
              ref={audioRef}
              src={recording.url}
              onPlay={() => setPlaying(true)}
              onPause={() => setPlaying(false)}
              onEnded={() => setPlaying(false)}
              className="hidden"
            />
          </div>
        )}
        {script.trim() && (
          <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground">
            {script}
          </p>
        )}
      </Card>
    </div>
  )
}
