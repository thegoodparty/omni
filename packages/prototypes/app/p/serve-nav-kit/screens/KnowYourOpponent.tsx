'use client'

import { Download, ExternalLink } from 'lucide-react'
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
  Avatar,
  AvatarFallback,
  Badge,
  Button,
  IconButton,
  SourceCitation,
} from '@goodparty_org/styleguide'
import { ScreenLayout } from '../components/ScreenLayout'
import { SectionLabel } from '../components/SectionLabel'

type Candidate = {
  id: string
  name: string
  initials: string
  party: string
  threat?: boolean
  summary: string
  website: string
  source: {
    organization: string
    title: string
    url: string
    chipLabel?: string
  }
  why: string
  background: string
  issues: string[]
}

const CANDIDATES: Candidate[] = [
  {
    id: 'guzman',
    name: 'Graciela Guzmán',
    initials: 'GG',
    party: 'Democrat · Incumbent',
    threat: true,
    summary:
      "The incumbent in a seat Ballotpedia rates one of Illinois' most left-leaning. Strong establishment and party backing; her edge is the air war, not district-level organizing.",
    website: 'Campaign website',
    source: {
      organization: 'Illinois State Board of Elections',
      title: 'Candidate filing',
      url: 'https://elections.il.gov',
      chipLabel: 'elections.il.gov +1',
    },
    why: "Voters here are getting an absentee incumbent who votes with the Speaker and skips the district. You're running to give the 21st a representative who actually shows up.",
    background:
      'Ten years organizing tenants in Logan Square and Avondale, two years on the CTA Citizens Advisory Board, and a small-business owner on Milwaukee Ave.',
    issues: [
      'Party loyalty and Speaker-aligned floor votes',
      'Developer-friendly housing policy',
      'Defunding the CTA advisory structure',
    ],
  },
  {
    id: 'okafor',
    name: 'Daniel Okafor',
    initials: 'DO',
    party: 'Republican · Challenger',
    summary:
      'A first-time candidate running on public-safety and small-business themes. Limited name recognition and a thin fundraising base so far.',
    website: 'Campaign website',
    source: {
      organization: 'Illinois State Board of Elections',
      title: 'Candidate filing',
      url: 'https://elections.il.gov',
      chipLabel: 'elections.il.gov',
    },
    why: 'He splits the anti-incumbent vote but has no district operation. Your ground game is the contrast.',
    background: 'Restaurant owner and neighborhood chamber board member.',
    issues: ['Public safety', 'Small-business tax relief', 'Permitting reform'],
  },
]

export const KnowYourOpponent = () => (
  <ScreenLayout
    title="Know Your Opponent"
    aiPlaceholder="Why is Graciela a main threat?"
    actions={
      <IconButton variant="ghost" size="small" aria-label="Download">
        <Download className="size-5" />
      </IconButton>
    }
  >
    <div className="space-y-1">
      <h2 className="text-foreground text-xl font-semibold sm:text-2xl">
        3 candidates filed for this seat
      </h2>
      <p className="text-muted-foreground text-sm">
        We identified and ranked every candidate running for Illinois State
        House, District 21.
      </p>
    </div>

    <Accordion
      type="single"
      collapsible
      defaultValue="guzman"
      className="space-y-3"
    >
      {CANDIDATES.map((c) => (
        <AccordionItem
          key={c.id}
          value={c.id}
          className="border-border rounded-2xl border px-4"
        >
          <AccordionTrigger className="hover:no-underline">
            <div className="flex flex-1 items-center gap-3">
              <Avatar className="size-10">
                <AvatarFallback className="text-sm font-semibold">
                  {c.initials}
                </AvatarFallback>
              </Avatar>
              <div className="text-left">
                <p className="text-foreground font-semibold">{c.name}</p>
                <p className="text-muted-foreground text-xs">{c.party}</p>
              </div>
              {c.threat && <Badge className="ml-auto mr-2">Main threat</Badge>}
            </div>
          </AccordionTrigger>
          <AccordionContent className="space-y-4">
            <p className="text-foreground text-sm">{c.summary}</p>
            <div className="flex flex-wrap items-center gap-3">
              <Button
                variant="link"
                size="small"
                className="h-auto gap-1.5 px-0"
              >
                <ExternalLink className="size-4" />
                {c.website}
              </Button>
              <SourceCitation
                {...c.source}
                description="Official candidate filing record."
              />
            </div>

            <Section label="Why they're running" body={c.why} />
            <Section label="Their background" body={c.background} />
            <div className="space-y-1">
              <SectionLabel>Issues that matter most to them</SectionLabel>
              <ul className="text-foreground list-disc space-y-1 pl-5 text-sm">
                {c.issues.map((issue) => (
                  <li key={issue}>{issue}</li>
                ))}
              </ul>
            </div>
          </AccordionContent>
        </AccordionItem>
      ))}
    </Accordion>
  </ScreenLayout>
)

const Section = ({ label, body }: { label: string; body: string }) => (
  <div className="space-y-1">
    <SectionLabel>{label}</SectionLabel>
    <p className="text-foreground text-sm">{body}</p>
  </div>
)
