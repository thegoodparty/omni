'use client'

import {
  type LucideIcon,
  Download,
  Calendar,
  MessageSquare,
  Megaphone,
  Phone,
  Users,
} from 'lucide-react'
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
  Badge,
  Button,
  Card,
  IconButton,
} from '@goodparty_org/styleguide'
import { ScreenLayout } from '../components/ScreenLayout'
import { SectionLabel } from '../components/SectionLabel'
import { PathToVictoryMeter } from '../components/PathToVictoryMeter'

type Task = {
  num: string
  date: string
  icon: LucideIcon
  title: string
  blurb: string
  meta?: string
}
type Stage = {
  id: string
  title: string
  blurb: string
  status: 'Done' | 'In progress' | 'Coming up'
  tasks?: Task[]
}

const STAGES: Stage[] = [
  {
    id: 'pre-launch',
    title: 'Pre-launch',
    blurb: 'Ballot access and campaign setup — all behind you.',
    status: 'Done',
  },
  {
    id: 'launch',
    title: 'Launch',
    blurb: 'Introduce yourself to voters across every channel.',
    status: 'Done',
  },
  {
    id: 'persuasion',
    title: 'Persuasion',
    blurb: 'Move undecided voters into your column.',
    status: 'In progress',
    tasks: [
      {
        num: '01',
        date: 'Sep 29',
        icon: MessageSquare,
        title: 'Send your persuasion text',
        blurb: 'Build trust and persuade cellphone voters to vote for you.',
        meta: '~76,661 cellphones',
      },
      {
        num: '02',
        date: 'Oct 1',
        icon: Megaphone,
        title: 'Pitch your local press',
        blurb: 'Aim for one piece of local coverage a week.',
      },
      {
        num: '03',
        date: 'Oct 6',
        icon: Phone,
        title: 'Schedule your persuasion robocall',
        blurb: 'Build trust and persuade landline voters to vote for you.',
        meta: '~12,722 landlines',
      },
      {
        num: '04',
        date: 'Oct 25',
        icon: Users,
        title: 'Work District 20 candidate forum',
        blurb: 'A shared-stage forum against the incumbent: free earned media.',
      },
    ],
  },
  {
    id: 'gotv',
    title: 'Get out the vote',
    blurb:
      'Push your supporters to actually vote — mail, early, and Election Day.',
    status: 'Coming up',
  },
]

const STATUS: Record<Stage['status'], 'default' | 'secondary' | 'outline'> = {
  Done: 'secondary',
  'In progress': 'default',
  'Coming up': 'outline',
}

export const CampaignTracker = () => (
  <ScreenLayout
    title="Campaign Tracker"
    aiPlaceholder="Hi Renee, how can I help?"
    actions={
      <IconButton variant="ghost" size="small" aria-label="Download">
        <Download className="size-5" />
      </IconButton>
    }
  >
    <div className="space-y-1">
      <h2 className="text-foreground text-xl font-semibold sm:text-2xl">
        Renee Wells for City Council
      </h2>
      <p className="text-muted-foreground text-sm">
        District 20 · Election Day Nov 3, 2026
      </p>
    </div>

    <Card className="gap-4 p-5">
      <SectionLabel>Your path to victory</SectionLabel>
      <p className="text-foreground text-sm">
        The projected voter turnout is <strong>60,353</strong> people. You need{' '}
        <strong>30,177</strong> of them to win, and you&apos;re at{' '}
        <strong>12,400</strong> likely so far.
      </p>
      <PathToVictoryMeter total={60353} current={12400} needed={30177} />
      <p className="text-muted-foreground text-sm">
        Every voter you reach enough times turns into a likely vote. About
        17,777 votes to go.
      </p>
    </Card>

    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-foreground text-lg font-semibold">Your Tracker</h2>
        <Badge variant="outline">You are here</Badge>
      </div>
      <p className="text-muted-foreground text-sm">
        Everything you need to do, in order. The current stage is open below.
      </p>

      <Accordion
        type="single"
        collapsible
        defaultValue="persuasion"
        className="space-y-3"
      >
        {STAGES.map((stage) => (
          <AccordionItem
            key={stage.id}
            value={stage.id}
            className="border-border rounded-2xl border px-4"
          >
            <AccordionTrigger className="hover:no-underline">
              <div className="flex flex-1 flex-col gap-1 text-left">
                <div className="flex items-center gap-2">
                  <span className="text-foreground font-semibold">
                    {stage.title}
                  </span>
                  <Badge variant={STATUS[stage.status]}>{stage.status}</Badge>
                </div>
                <span className="text-muted-foreground text-sm">
                  {stage.blurb}
                </span>
              </div>
            </AccordionTrigger>
            {stage.tasks && (
              <AccordionContent className="space-y-3">
                {stage.tasks.map((task) => {
                  const Icon = task.icon
                  return (
                    <Card
                      key={task.num}
                      className="flex-row gap-3 rounded-xl p-3 shadow-none"
                    >
                      <span className="bg-muted text-muted-foreground flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold">
                        {task.num}
                      </span>
                      <div className="space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge variant="outline">{task.date}</Badge>
                          <Icon className="text-muted-foreground size-4" />
                          <span className="text-foreground text-sm font-semibold">
                            {task.title}
                          </span>
                        </div>
                        <p className="text-muted-foreground text-sm">
                          {task.blurb}
                        </p>
                        <div className="flex flex-wrap items-center gap-3 pt-1">
                          {task.meta && (
                            <span className="text-muted-foreground text-xs">
                              {task.meta}
                            </span>
                          )}
                          <Button
                            variant="link"
                            size="small"
                            className="h-auto gap-1 px-0 text-xs"
                          >
                            <Calendar className="size-3.5" />
                            Open the tool
                          </Button>
                        </div>
                      </div>
                    </Card>
                  )
                })}
              </AccordionContent>
            )}
          </AccordionItem>
        ))}
      </Accordion>
    </section>
  </ScreenLayout>
)
