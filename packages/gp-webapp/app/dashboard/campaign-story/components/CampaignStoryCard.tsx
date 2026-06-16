'use client'

import { useState } from 'react'
import {
  Button,
  Card,
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
  Textarea,
  MinusIcon,
  PlusIcon,
  SparklesIcon,
  WandSparklesIcon,
} from '@styleguide'

export interface CampaignStorySection {
  id: string
  title: string
  description: string
  placeholder: string
}

const NOT_ANSWERED_HINT =
  'Not answered yet. Even two sentences here unlocks a lot.'

interface CampaignStoryCardProps {
  section: CampaignStorySection
}

const CampaignStoryCard = ({
  section,
}: CampaignStoryCardProps): React.JSX.Element => {
  const { title, description, placeholder } = section
  const [value, setValue] = useState('')
  const [expanded, setExpanded] = useState(true)
  const answered = value.trim().length > 0

  return (
    <Card className="p-6">
      <Collapsible open={expanded} onOpenChange={setExpanded}>
        <div className="flex items-start justify-between gap-4">
          <div className="flex flex-col gap-1">
            <h3 className="text-xl font-semibold text-foreground">{title}</h3>
            <p className="text-sm text-muted-foreground">{description}</p>
          </div>
          <CollapsibleTrigger asChild>
            <Button
              variant="ghost"
              size="small"
              className="size-8 rounded-full p-0"
              aria-label={expanded ? `Collapse ${title}` : `Expand ${title}`}
            >
              {expanded ? <MinusIcon /> : <PlusIcon />}
            </Button>
          </CollapsibleTrigger>
        </div>

        <CollapsibleContent className="overflow-hidden data-[state=closed]:animate-collapsible-up data-[state=open]:animate-collapsible-down">
          <div className="mt-4 flex flex-col gap-4">
            <Textarea
              value={value}
              onChange={(event) => setValue(event.target.value)}
              placeholder={placeholder}
              className="min-h-28"
            />

            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex flex-1 items-start gap-2 rounded-lg bg-primary/5 p-3">
                <SparklesIcon className="mt-0.5 size-4 shrink-0 text-primary" />
                <div className="flex flex-col gap-0.5">
                  <span className="text-xs font-bold uppercase tracking-wide text-primary">
                    Campaign Manager
                  </span>
                  <span className="text-sm text-foreground">
                    {answered
                      ? 'Looking good. Want help tightening it?'
                      : NOT_ANSWERED_HINT}
                  </span>
                </div>
              </div>

              <Button icon={<WandSparklesIcon />} className="sm:shrink-0">
                Help me rewrite
              </Button>
            </div>
          </div>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  )
}

export default CampaignStoryCard
