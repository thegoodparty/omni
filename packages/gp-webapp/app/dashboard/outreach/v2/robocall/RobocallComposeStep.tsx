'use client'

import { type ReactNode, useEffect, useRef, useState } from 'react'
import {
  ROBOCALL_SCRIPT_MAX_LENGTH,
  type RobocallComplianceVerdict,
  SOCIAL_TONE_VALUES,
  type SocialTone,
} from '@goodparty_org/contracts'
import {
  Button,
  Card,
  cn,
  FilterPill,
  FilterPillGroup,
  IconButton,
  Textarea,
} from '@styleguide'
import {
  ClockIcon,
  Loader2Icon,
  MicIcon,
  PauseIcon,
  PlayIcon,
  RefreshIcon,
  SmileIcon,
  SquareIcon,
  SunIcon,
  TargetIcon,
  Trash2Icon,
  UploadIcon,
} from '@styleguide/components/ui/icons'
import { Intro } from '../social/Intro'
import { type RobocallRecorder } from './useRobocallRecorder'

const TONE_LABELS: Record<SocialTone, string> = {
  warm: 'Warm',
  direct: 'Direct',
  urgent: 'Urgent',
  friendly: 'Friendly',
}

const TONE_ICONS: Record<SocialTone, ReactNode> = {
  warm: <SunIcon className="size-4" />,
  direct: <TargetIcon className="size-4" />,
  urgent: <ClockIcon className="size-4" />,
  friendly: <SmileIcon className="size-4" />,
}

const fmtDur = (secs: number): string =>
  `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`

interface RobocallComposeStepProps {
  tone: SocialTone
  onToneChange: (tone: SocialTone) => void
  isCustomPurpose: boolean
  // The drafted (or custom-authored) script the candidate reads aloud. For
  // non-custom purposes it's AI-generated and read-only; custom is a textarea.
  draft: string
  onDraftChange: (draft: string) => void
  onRegenerate: () => void
  isDrafting: boolean
  isDraftError: boolean
  audienceName: string
  // The rented caller-ID number the candidate must read aloud (the drafted
  // script includes it). Null while renting or if renting failed.
  callbackNumber: string | null
  isRentingNumber: boolean
  rentError: boolean
  onRetryNumber: () => void
  recorder: RobocallRecorder
  maxSeconds: number
  // Save uploads the recording to S3, then marks it saved; while it runs the
  // Save button shows a spinner, and a failure surfaces uploadError.
  onSaveRecording: () => void
  isUploading: boolean
  uploadError: string | null
  // Compliance gate on the saved recording: while checking, a spinner; a
  // verdict with passed=false lists the issues to re-record against; an error
  // (transcription/LLM failure) offers a retry.
  complianceChecking: boolean
  complianceVerdict: RobocallComplianceVerdict | null
  complianceError: boolean
  onRetryCompliance: () => void
}

export const RobocallComposeStep = ({
  tone,
  onToneChange,
  isCustomPurpose,
  draft,
  onDraftChange,
  onRegenerate,
  isDrafting,
  isDraftError,
  audienceName,
  callbackNumber,
  isRentingNumber,
  rentError,
  onRetryNumber,
  recorder,
  maxSeconds,
  onSaveRecording,
  isUploading,
  uploadError,
  complianceChecking,
  complianceVerdict,
  complianceError,
  onRetryCompliance,
}: RobocallComposeStepProps) => {
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const [playing, setPlaying] = useState(false)
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  // A new/re-recorded clip resets playback (the old audio element is gone).
  useEffect(() => setPlaying(false), [recorder.recording?.url])

  const togglePlay = () => {
    const el = audioRef.current
    if (!el) return
    // Catch the play() rejection (e.g. an unsupported source) so it doesn't
    // surface as an uncaught promise error, and reset the play/pause icon.
    if (el.paused) el.play().catch(() => setPlaying(false))
    else el.pause()
  }

  return (
    <div className="space-y-6">
      <Intro
        channel="robocall"
        title="What do you want to say?"
        body="Read the script below into your microphone. We'll play it for your recipients."
      />

      {!callbackNumber && isRentingNumber && (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2Icon className="size-4 animate-spin" />
          Getting your callback number…
        </p>
      )}

      {!callbackNumber && rentError && (
        <Card className="items-start gap-3 border-destructive p-4">
          <p className="text-sm text-foreground">
            We couldn&apos;t get a callback number just now. Your recording
            needs one, so try again.
          </p>
          <Button type="button" size="small" onClick={onRetryNumber}>
            Try again
          </Button>
        </Card>
      )}

      {/* The number gates the whole body: the script must carry the spoken
          disclosure with it, so there's nothing to draft, tone, or record
          until it's rented. */}
      {callbackNumber && (
        <>
          {!isCustomPurpose && (
            <FilterPillGroup
              type="single"
              value={tone}
              onValueChange={(value) =>
                value && onToneChange(value as SocialTone)
              }
            >
              {SOCIAL_TONE_VALUES.map((t) => (
                <FilterPill key={t} value={t} className="gap-1.5">
                  {TONE_ICONS[t]}
                  {TONE_LABELS[t]}
                </FilterPill>
              ))}
            </FilterPillGroup>
          )}

          {!isCustomPurpose && (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm text-muted-foreground">
                Suggested for {audienceName}
              </p>
              <Button
                type="button"
                variant="link"
                size="small"
                className="h-auto gap-1.5 px-0 no-underline"
                disabled={isDrafting}
                onClick={onRegenerate}
              >
                {isDrafting ? (
                  <Loader2Icon className="size-4 animate-spin" />
                ) : (
                  <RefreshIcon className="size-4" />
                )}
                Regenerate
              </Button>
            </div>
          )}

          {isDraftError && (
            <Card className="items-start gap-3 border-destructive p-4">
              <p className="text-sm text-foreground">
                We couldn&apos;t draft your script just now. Try again, or write
                your own.
              </p>
              <Button type="button" size="small" onClick={onRegenerate}>
                Try again
              </Button>
            </Card>
          )}

          <Card className="gap-2 p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Read this on your recording
            </p>
            {isCustomPurpose ? (
              <Textarea
                value={draft}
                onChange={(e) => onDraftChange(e.target.value)}
                placeholder="Write your script…"
                aria-label="Robocall script"
                maxLength={ROBOCALL_SCRIPT_MAX_LENGTH}
                className="min-h-[120px] resize-none border-0 p-0 focus-visible:ring-0 [field-sizing:content]"
              />
            ) : isDrafting && !draft.trim() ? (
              <p className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
                <Loader2Icon className="size-4 animate-spin" />
                Drafting your script…
              </p>
            ) : (
              <p
                data-vaul-no-drag
                className="select-text whitespace-pre-wrap text-base leading-relaxed text-foreground"
              >
                {draft}
              </p>
            )}
            <p
              data-vaul-no-drag
              className="select-text text-xs text-muted-foreground"
            >
              Your recording must say who paid for the call and include this
              callback number: {callbackNumber}.
            </p>
          </Card>

          <p className="text-xs text-muted-foreground">
            Your recording must be {maxSeconds} seconds or less — anything
            longer will be removed.
          </p>

          <RecordBar
            recorder={recorder}
            maxSeconds={maxSeconds}
            playing={playing}
            onTogglePlay={togglePlay}
            audioRef={audioRef}
            onAudioPlay={() => setPlaying(true)}
            onAudioPause={() => setPlaying(false)}
            fileInputRef={fileInputRef}
            onSave={onSaveRecording}
            isUploading={isUploading}
            complianceChecking={complianceChecking}
            complianceProblem={
              (!!complianceVerdict && !complianceVerdict.passed) ||
              complianceError
            }
          />

          {(recorder.error || uploadError) && (
            <p className="text-sm text-destructive">
              {recorder.error ?? uploadError}
            </p>
          )}

          {complianceError && (
            <Card className="items-start gap-3 border-destructive p-4">
              <p className="text-sm text-foreground">
                We couldn&apos;t check your recording just now. Try again.
              </p>
              <Button type="button" size="small" onClick={onRetryCompliance}>
                Try again
              </Button>
            </Card>
          )}

          {complianceVerdict && !complianceVerdict.passed && (
            <Card className="items-start gap-2 border-destructive p-4">
              <p
                data-vaul-no-drag
                className="select-text text-sm font-medium text-foreground"
              >
                Your recording is missing:
              </p>
              <ul
                data-vaul-no-drag
                className="select-text list-disc space-y-1 pl-5 text-sm text-muted-foreground"
              >
                {complianceVerdict.issues.map((issue) => (
                  <li key={issue}>{issue}</li>
                ))}
              </ul>
              <p
                data-vaul-no-drag
                className="select-text text-sm text-muted-foreground"
              >
                Re-record with all of these and we&apos;ll check again.
              </p>
            </Card>
          )}

          {complianceVerdict?.passed && (
            <Card className="gap-1 border-success p-4">
              <p className="text-sm font-medium text-foreground">
                Your recording has everything it needs.
              </p>
              <p className="text-sm text-muted-foreground">
                It names you, who paid for the call, and the callback number.
              </p>
            </Card>
          )}
        </>
      )}
    </div>
  )
}

interface RecordBarProps {
  recorder: RobocallRecorder
  maxSeconds: number
  playing: boolean
  onTogglePlay: () => void
  audioRef: React.RefObject<HTMLAudioElement | null>
  onAudioPlay: () => void
  onAudioPause: () => void
  fileInputRef: React.RefObject<HTMLInputElement | null>
  onSave: () => void
  isUploading: boolean
  complianceChecking: boolean
  complianceProblem: boolean
}

const RecordBar = ({
  recorder,
  maxSeconds,
  playing,
  onTogglePlay,
  audioRef,
  onAudioPlay,
  onAudioPause,
  fileInputRef,
  onSave,
  isUploading,
  complianceChecking,
  complianceProblem,
}: RecordBarProps) => {
  if (recorder.status === 'recording') {
    return (
      <Card className="flex-row items-center gap-3 p-4">
        <IconButton
          type="button"
          variant="destructive"
          size="large"
          aria-label="Stop recording"
          onClick={recorder.stop}
        >
          <SquareIcon className="size-5" />
        </IconButton>
        <div className="flex h-8 flex-1 items-center gap-[3px]">
          {Array.from({ length: 24 }).map((_, i) => (
            <span
              key={i}
              className="block h-full w-[3px] origin-center rounded-full bg-destructive/70"
              style={{
                animation: `gp-bar 800ms ease-in-out ${(i % 8) * 90}ms infinite`,
              }}
            />
          ))}
        </div>
        <span className="ml-auto text-sm font-medium tabular-nums">
          {fmtDur(recorder.elapsedSec)} / {fmtDur(maxSeconds)}
        </span>
      </Card>
    )
  }

  const rec = recorder.recording
  if (rec) {
    const saved = recorder.status === 'saved'
    return (
      <Card
        className={cn(
          'flex-row items-center gap-3 p-4',
          saved && complianceProblem && 'border-destructive',
        )}
      >
        <IconButton
          type="button"
          variant="default"
          size="large"
          aria-label={playing ? 'Pause' : 'Play'}
          onClick={onTogglePlay}
        >
          {playing ? (
            <PauseIcon className="size-5" />
          ) : (
            <PlayIcon className="size-5" />
          )}
        </IconButton>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-foreground">
            {saved ? 'Recording saved' : 'Preview your recording'}
          </p>
          <p className="text-xs tabular-nums text-muted-foreground">
            {fmtDur(rec.durationSec)}
          </p>
        </div>
        {saved ? (
          complianceChecking ? (
            <span className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2Icon className="size-4 animate-spin" />
              Checking…
            </span>
          ) : (
            <Button
              type="button"
              variant="ghost"
              size="small"
              onClick={recorder.discard}
            >
              <Trash2Icon className="size-4" />
              Re-record
            </Button>
          )
        ) : (
          <>
            <IconButton
              type="button"
              variant="ghost"
              size="small"
              aria-label="Discard"
              onClick={recorder.discard}
              disabled={isUploading}
            >
              <Trash2Icon className="size-4" />
            </IconButton>
            <Button
              type="button"
              size="small"
              onClick={onSave}
              disabled={isUploading}
            >
              {isUploading && <Loader2Icon className="size-4 animate-spin" />}
              {isUploading ? 'Saving…' : 'Save'}
            </Button>
          </>
        )}
        <audio
          ref={audioRef}
          src={rec.url}
          onPlay={onAudioPlay}
          onPause={onAudioPause}
          onEnded={onAudioPause}
          className="hidden"
        />
      </Card>
    )
  }

  return (
    <div className="flex flex-col gap-3 sm:flex-row">
      <input
        ref={fileInputRef}
        type="file"
        accept="audio/*"
        className="hidden"
        onChange={(e) => recorder.uploadFile(e.target.files?.[0])}
      />
      <Card className="flex-1 items-center justify-center gap-2.5 p-5">
        <IconButton
          type="button"
          variant="destructive"
          size="large"
          aria-label="Start recording"
          onClick={recorder.start}
        >
          <MicIcon className="size-6" />
        </IconButton>
        <span className="text-sm font-medium">Record now</span>
      </Card>
      <Card className="flex-1 items-center justify-center gap-2.5 p-5">
        <Button
          type="button"
          variant="ghost"
          size="small"
          onClick={() => fileInputRef.current?.click()}
        >
          <UploadIcon className="size-4" />
          Upload audio
        </Button>
        <span className="text-xs text-muted-foreground">
          MP3, WAV, M4A, or OGG
        </span>
      </Card>
    </div>
  )
}
