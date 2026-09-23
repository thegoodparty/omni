'use client'

import {
  ExternalLink,
  FilePlus2,
  MessageSquare,
  Microscope,
  Wrench,
} from 'lucide-react'
import { Button, Card, CardContent } from '@goodparty_org/styleguide'
import { data } from '../lib/data'

const SLACK = 'https://goodpartyorg.slack.com/archives/C0BECEK0603'

/**
 * Finding an event is rarely the last step. These are the exits; the two that file
 * something both point at the same ClickUp intake form, which comes from the snapshot
 * so it is set in one place. "Dig into an area" is still a guess at a real need.
 */
const actions = (formUrl: string) => [
  {
    icon: FilePlus2,
    title: 'Request an event',
    blurb:
      'Nothing here measures what you need. File it so the next sweep picks it up.',
    href: formUrl,
    cta: 'Open the form',
  },
  {
    icon: Wrench,
    title: 'Report something broken',
    blurb:
      'An event is firing wrong, double-counting, or its description is out of date.',
    href: formUrl,
    cta: 'Open the form',
  },
  {
    icon: MessageSquare,
    title: 'Ask a question',
    blurb: 'Not sure what you are looking at? Ask in #product-analytics.',
    href: SLACK,
    cta: 'Open #product-analytics',
  },
  {
    icon: Microscope,
    title: 'Dig into an area',
    blurb:
      'See every event, gap and question for one product area in one place.',
    href: '',
    cta: 'Coming soon',
  },
]

export const WhatsNext = () => {
  const items = actions(data.request_form_url)
  const live = items.filter((a) => a.href).length

  return (
    <Card className="border-dashed">
      <CardContent className="space-y-3 p-4">
        <div className="flex flex-wrap items-baseline gap-2">
          <h2 className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
            What&apos;s next
          </h2>
          {live < 3 && (
            <span className="text-xs text-muted-foreground">
              placeholder — most of these are not wired up yet
            </span>
          )}
        </div>
        <div className="grid grid-cols-1 gap-2 md:grid-cols-2 lg:grid-cols-4">
          {items.map(({ icon: Icon, title, blurb, href, cta }) => (
            <div key={title} className="rounded-lg border p-3">
              <div className="flex items-center gap-2 text-sm font-medium">
                <Icon className="h-4 w-4 text-muted-foreground" />
                {title}
              </div>
              <p className="mt-1 text-xs text-muted-foreground">{blurb}</p>
              {href ? (
                <Button asChild size="small" variant="outline" className="mt-2">
                  <a href={href} target="_blank" rel="noreferrer">
                    {cta} <ExternalLink className="ml-1 h-3 w-3" />
                  </a>
                </Button>
              ) : (
                <Button
                  size="small"
                  variant="outline"
                  className="mt-2"
                  disabled
                >
                  {cta} <ExternalLink className="ml-1 h-3 w-3" />
                </Button>
              )}
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}
