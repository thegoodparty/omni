'use client'

import {
  ExternalLink,
  HelpCircle,
  Microscope,
  TriangleAlert,
} from 'lucide-react'
import { Button, Card, CardContent } from '@goodparty_org/styleguide'
import { data } from '../lib/data'

const SLACK = 'https://goodpartyorg.slack.com/archives/C0BECEK0603'

/**
 * There is deliberately no "request an event" exit. Nobody arrives wanting an event;
 * they arrive wanting to know whether users do something, and the event is how we
 * answer that. Asking them to name the instrument is the mental model this page
 * exists to remove, so the intake takes the question and the instrument follows.
 */
const actions = (formUrl: string) => [
  {
    icon: HelpCircle,
    title: 'Ask for something to be measured',
    blurb:
      'Ask in your own words, not in event names. It joins the questions list; nudge us in Slack if it is urgent.',
    href: formUrl,
    cta: 'Open the form',
  },
  {
    icon: TriangleAlert,
    title: 'Something look wrong?',
    blurb:
      'A number that cannot be right, an event firing twice, a description that is out of date.',
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

export const WhatsNext = () => (
  <Card className="border-dashed">
    <CardContent className="space-y-3 p-4">
      <h2 className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
        What&apos;s next
      </h2>
      <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
        {actions(data.request_form_url).map(
          ({ icon: Icon, title, blurb, href, cta }) => (
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
                  Coming soon
                </Button>
              )}
            </div>
          ),
        )}
      </div>
    </CardContent>
  </Card>
)
