'use client'

import { Lightbulb, ChevronDown, Sparkles, Mic } from 'lucide-react'
import {
  Button,
  Card,
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
  IconButton,
  Textarea,
} from '@goodparty_org/styleguide'
import { ScreenLayout } from '../components/ScreenLayout'
import { SectionLabel } from '../components/SectionLabel'

const QUESTIONS = [
  {
    title: 'Your why',
    description:
      'The moment, the people, the breaking point: your stump-speech opener.',
    example:
      'A strong answer names a specific moment and the people it affected — not a slogan.',
    placeholder:
      'Tap to write: what pushed you to put your name on the ballot?',
  },
  {
    title: 'Your background',
    description:
      'Childhood, career, community ties. The human story behind the candidate.',
    example:
      'Ground it in place and work: where you grew up, what you did, who you served.',
    placeholder: 'Tap to write: your background, career, and what shaped you.',
  },
  {
    title: 'The issues you’ll fight for',
    description: 'The two or three things voters will remember you for.',
    example:
      'Pick a few concrete issues and say what you’ll actually do about them.',
    placeholder: 'Tap to write: the issues at the center of your campaign.',
  },
]

export const YourStory = () => (
  <ScreenLayout title="Your Story" aiPlaceholder="Hi Renee, how can I help?">
    <div className="space-y-1">
      <SectionLabel>Campaign story</SectionLabel>
      <p className="text-muted-foreground text-sm">
        This is the foundation we build everything else on: your why, your
        background, and the issues you&apos;ll fight for. Tap any answer to edit
        it, or let your Campaign Manager help you sharpen it.
      </p>
    </div>

    {QUESTIONS.map((q) => (
      <Card key={q.title} className="gap-4 p-5">
        <div className="space-y-1">
          <h2 className="text-foreground text-lg font-semibold">{q.title}</h2>
          <p className="text-muted-foreground text-sm">{q.description}</p>
        </div>

        <Collapsible>
          <CollapsibleTrigger className="text-primary flex items-center gap-1.5 text-sm font-medium">
            <Lightbulb className="size-4" />
            See what a strong answer looks like
            <ChevronDown className="size-4" />
          </CollapsibleTrigger>
          <CollapsibleContent className="text-muted-foreground pt-2 text-sm">
            {q.example}
          </CollapsibleContent>
        </Collapsible>

        <div className="relative">
          <Textarea placeholder={q.placeholder} rows={4} className="pr-12" />
          <IconButton
            variant="ghost"
            size="small"
            aria-label="Dictate"
            className="absolute right-2 bottom-2"
          >
            <Mic className="size-4" />
          </IconButton>
        </div>

        <div className="flex items-center justify-between">
          <span className="text-muted-foreground text-xs">0 characters</span>
          <Button size="small">
            <Sparkles className="size-4" />
            Help me rewrite
          </Button>
        </div>
      </Card>
    ))}
  </ScreenLayout>
)
