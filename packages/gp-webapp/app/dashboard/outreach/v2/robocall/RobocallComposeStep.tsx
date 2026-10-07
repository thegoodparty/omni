'use client'

import { type ReactNode, useEffect, useRef, useState } from 'react'
import {
  ROBOCALL_SCRIPT_MAX_LENGTH,
  type RobocallComplianceVerdict,
  type RobocallProtectedPart,
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
  type ProtectedSpec,
  TokenField,
} from '@styleguide'
import {
  ClockIcon,
  Loader2Icon,
  MicIcon,
  PauseIcon,
  PlayIcon,
  RefreshIcon,
  SmileIcon,
  SparklesIcon,
  SquareIcon,
  SunIcon,
  TargetIcon,
  Trash2Icon,
  UploadIcon,
} from '@styleguide/components/ui/icons'
import { LengthCounter } from 'app/dashboard/shared/compose/LengthCounter'
import { Intro } from '../social/Intro'
import { type RobocallRecorder } from './useRobocallRecorder'

// Why each locked part cannot change, shown when an edit runs into it.
const LOCK_REASONS: Record<RobocallProtectedPart['rule'], string> = {
  candidate_name:
    "A recorded call has to say who's calling, but you can reword the rest.",
  disclosure: 'The law requires this line, read exactly as written.',
}

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
  // The whole script the candidate reads aloud, the disclosure line included.
  script: string
  onScriptChange: (script: string) => void
  // The parts of `script` nobody may change, from deriveRobocallProtectedParts.
  protectedParts: RobocallProtectedPart[]
  // Whether there is anything to read besides the disclosure.
  hasWrittenBody: boolean
  // The one AI action: a fresh draft while the words are still the AI's,
  // a polish once they are the candidate's own.
  aiAction: 'regenerate' | 'improve'
  onAiAction: () => void
  isDrafting: boolean
  isDraftError: boolean
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
  scriptChangedSinceRecording: boolean
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
  script,
  onScriptChange,
  protectedParts,
  hasWrittenBody,
  aiAction,
  onAiAction,
  isDrafting,
  isDraftError,
  callbackNumber,
  isRentingNumber,
  rentError,
  onRetryNumber,
  recorder,
  maxSeconds,
  onSaveRecording,
  scriptChangedSinceRecording,
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
  const [lockReason, setLockReason] = useState<string | null>(null)
  useEffect(() => setLockReason(null), [script])
  const protectedRanges: ProtectedSpec[] = protectedParts.map((part) => ({
    id: part.rule,
    text: part.text,
    // The copy the lock rules chose (the closing line, not a quote of it).
    start: part.start,
    reason: LOCK_REASONS[part.rule],
  }))
  const isImprove = aiAction === 'improve'
  const awaitingFirstDraft = isDrafting && !script.trim()

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

          {isDraftError && (
            <Card className="items-start gap-3 border-destructive p-4">
              <p className="text-sm text-foreground">
                We couldn&apos;t draft your script just now. Try again, or write
                your own.
              </p>
              <Button type="button" size="small" onClick={onAiAction}>
                Try again
              </Button>
            </Card>
          )}

          <Card className="gap-2 p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Read this on your recording
            </p>
            <TokenField
              value={script}
              onChange={onScriptChange}
              protectedRanges={protectedRanges}
              onBlockedEdit={(target) =>
                setLockReason('reason' in target ? target.reason : null)
              }
              // Read-only until the first draft lands, so nothing typed is
              // overwritten by it.
              readOnly={awaitingFirstDraft}
              placeholder={
                awaitingFirstDraft
                  ? 'Drafting your script…'
                  : 'Write your script…'
              }
              aria-label="Robocall script"
              maxLength={ROBOCALL_SCRIPT_MAX_LENGTH}
              variant="seamless"
              className="min-h-[120px]"
            />
            <LengthCounter
              length={script.length}
              max={ROBOCALL_SCRIPT_MAX_LENGTH}
            />
            <p
              data-vaul-no-drag
              className="select-text text-xs text-muted-foreground"
            >
              Read the last line as written: it says who paid for the call and
              how to call back.
            </p>
            <p role="status" className="min-h-4 text-xs text-foreground">
              {lockReason}
            </p>
            <div className="-mx-4 -mb-4 mt-2 flex items-center justify-end gap-1 border-t border-border p-2">
              {(!isImprove || hasWrittenBody) && (
                <Button
                  type="button"
                  variant="ghost"
                  size="small"
                  className="text-muted-foreground"
                  disabled={isDrafting}
                  onClick={onAiAction}
                >
                  {isDrafting ? (
                    <Loader2Icon className="size-4 animate-spin" />
                  ) : isImprove ? (
                    <SparklesIcon className="size-4" />
                  ) : (
                    <RefreshIcon className="size-4" />
                  )}
                  {isImprove ? 'Improve with AI' : 'Regenerate'}
                </Button>
              )}
            </div>
          </Card>

          <p className="text-xs text-muted-foreground">
            Your recording must be {maxSeconds} seconds or less — anything
            longer will be removed.
          </p>

          {/* Compliance result sits ABOVE the record card so the candidate
              sees the verdict (or the re-record prompt) before the recording
              controls, not scrolled below them. */}
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

          {scriptChangedSinceRecording && (
            <p className="text-xs text-muted-foreground">
              Your script changed after you recorded, so re-record if you want
              them to match.
            </p>
          )}

          {(recorder.error || uploadError) && (
            <p className="text-sm text-destructive">
              {recorder.error ?? uploadError}
            </p>
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

// The compliance check is one request that transcribes the clip then runs the
// LLM disclosure check, with no per-phase signal back. Show a two-phase label
// so the wait reads as progress rather than a single stalled spinner: the
// transcription first, then the compliance review after a beat. Time-based, not
// driven by real phase events — remounts (and so resets) each time a check runs.
const TRANSCRIBING_LABEL_MS = 5000

const CheckingLabel = () => {
  const [phase, setPhase] = useState<'transcribing' | 'compliance'>(
    'transcribing',
  )
  useEffect(() => {
    const timer = setTimeout(
      () => setPhase('compliance'),
      TRANSCRIBING_LABEL_MS,
    )
    return () => clearTimeout(timer)
  }, [])
  return (
    <span className="flex items-center gap-2 text-sm text-muted-foreground">
      <Loader2Icon className="size-4 animate-spin" />
      {phase === 'transcribing' ? 'Transcribing…' : 'Checking for compliance…'}
    </span>
  )
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

  if (recorder.status === 'processing') {
    return (
      <Card className="flex-row items-center gap-3 p-4">
        <Loader2Icon className="size-5 animate-spin text-muted-foreground" />
        <span className="text-sm font-medium text-foreground">
          Checking your recording
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
            <CheckingLabel />
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
