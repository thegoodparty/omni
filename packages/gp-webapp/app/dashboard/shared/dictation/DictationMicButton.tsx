'use client'

import { cn, IconButton, Loader2Icon, MicIcon, SquareIcon } from '@styleguide'
import type { UseDictationAppendResult } from './useDictationAppend'

type Props = {
  dictation: UseDictationAppendResult
  idleLabel: string
  recordingLabel: string
  /** Caller-level disable (e.g. parent is saving). Hook-level busy is handled internally. */
  disabled?: boolean
  /** Button + icon scale. `small` overlays a textarea corner; `medium` sits inline in a composer. */
  size?: 'small' | 'medium'
  /** Overrides the default `absolute bottom-2 right-2` placement. */
  className?: string
}

const DEFAULT_PLACEMENT = 'absolute bottom-2 right-2'

export function DictationMicButton({
  dictation,
  idleLabel,
  recordingLabel,
  disabled,
  size = 'small',
  className,
}: Props): React.JSX.Element {
  const isRecording = dictation.status === 'recording'
  const label = isRecording ? recordingLabel : idleLabel
  const iconSize = size === 'medium' ? 'size-5' : 'size-4'
  return (
    <IconButton
      type="button"
      variant="ghost"
      size={size}
      aria-label={label}
      disabled={disabled || dictation.status === 'stopping'}
      onClick={() => {
        void dictation.toggle()
      }}
      className={cn(DEFAULT_PLACEMENT, className)}
    >
      {dictation.busy ? (
        <Loader2Icon className={cn(iconSize, 'animate-spin')} aria-hidden />
      ) : isRecording ? (
        <SquareIcon
          className={cn(iconSize, 'animate-pulse text-red-500')}
          aria-hidden
        />
      ) : (
        <MicIcon className={iconSize} aria-hidden />
      )}
    </IconButton>
  )
}
