'use client'

import { useState } from 'react'
import {
  Button,
  Card,
  Textarea,
  SparklesIcon,
  WandSparklesIcon,
} from '@styleguide'

export interface CampaignStorySection {
  id: string
  title: string
  description: string
  placeholder: string
}

const EMPTY_HINT = 'Not answered yet. Even two sentences here unlocks a lot.'
const STARTED_HINT =
  'Worth saying more: another 1-2 sentences will sharpen this a lot.'

// The counter denominator, and the point past which the answer stands on its
// own so we drop the nudge rather than make a quality claim we can't back up
// from a length signal. A suggestion shown to the writer, NOT an input cap —
// typing past it is allowed (the textarea has no maxLength).
const SUGGESTED_CHARS = 100

interface CampaignStoryCardProps {
  section: CampaignStorySection
}

const CampaignStoryCard = ({
  section,
}: CampaignStoryCardProps): React.JSX.Element => {
  const { title, description, placeholder } = section
  const [value, setValue] = useState('')
  const trimmedLength = value.trim().length
  const hint =
    trimmedLength === 0
      ? EMPTY_HINT
      : trimmedLength < SUGGESTED_CHARS
        ? STARTED_HINT
        : null

  return (
    <Card className="p-6">
      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h3 className="text-xl font-semibold text-foreground">{title}</h3>
          <p className="text-sm text-muted-foreground">{description}</p>
        </div>
        <span className="shrink-0 text-sm tabular-nums text-muted-foreground">
          {value.length}/{SUGGESTED_CHARS}
        </span>
      </div>

      <div className="mt-4 flex flex-col gap-4">
        <Textarea
          value={value}
          onChange={(event) => setValue(event.target.value)}
          placeholder={placeholder}
          className="min-h-28"
        />

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          {hint && (
            <div className="flex flex-1 items-start gap-2 rounded-lg bg-primary/5 p-3">
              <SparklesIcon className="mt-0.5 size-4 shrink-0 text-primary" />
              <div className="flex flex-col gap-0.5">
                <span className="text-xs font-bold uppercase tracking-wide text-primary">
                  Campaign Manager
                </span>
                <span className="text-sm text-foreground">{hint}</span>
              </div>
            </div>
          )}

          <Button
            icon={<WandSparklesIcon />}
            className="sm:ml-auto sm:shrink-0"
          >
            Help me rewrite
          </Button>
        </div>
      </div>
    </Card>
  )
}

export default CampaignStoryCard
