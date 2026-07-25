'use client'

import { useEffect, useRef, useState } from 'react'
import {
  type LucideIcon,
  Info,
  Archive,
  Users,
  Calendar,
  Clock,
  Megaphone,
  MessageSquare,
  LayoutDashboard,
} from 'lucide-react'
import {
  Button,
  Card,
  ContentCard,
  Progress,
  cn,
} from '@goodparty_org/styleguide'
import { ScreenLayout } from '../components/ScreenLayout'

type Task = {
  category: string
  categoryIcon: LucideIcon
  title: string
  blurb: string
  people: string
  date: string
  duration: string
  action: string
}

const LIKELY = 12400
const NEEDED = 30177

const TASKS: Task[] = [
  {
    category: 'Voter outreach',
    categoryIcon: Users,
    title: 'Call 25 likely-Dem seniors about the SB-2027 property tax',
    blurb:
      'Seniors over 65 are 71% of your high-turnout universe and SB-2027 polled +38 with them — this is the single best persuasion conversation you can have right now.',
    people: '773',
    date: 'Mon Jun 22, 2:00 PM',
    duration: '~1 hr',
    action: 'Open senior call list',
  },
  {
    category: 'Campaign manager',
    categoryIcon: LayoutDashboard,
    title: 'Attend the Riverside Neighborhood Assoc. meeting (Thu 7 PM)',
    blurb:
      "RNA's president Maria Delgado endorsed your opponent in 2022 by 6 points — showing up in person is how you start flipping that endorsement.",
    people: '189',
    date: 'Tue Jun 16, 9:00 AM',
    duration: '~2 hrs',
    action: 'Mark as attended',
  },
  {
    category: 'Messaging',
    categoryIcon: MessageSquare,
    title: 'Record a 30-second intro video at the Decatur lakefront',
    blurb:
      'Video posts shot in recognizable District 48 locations get 3× the reach of indoor selfie video in our test markets.',
    people: '1,379',
    date: 'Fri Jun 19, 2:00 PM',
    duration: '~20 min',
    action: 'Record video',
  },
  {
    category: 'Fundraising',
    categoryIcon: Megaphone,
    title: 'Send a call-time thank-you to your 8 May donors',
    blurb:
      'Donors who hear back within a week give again at 2× the rate — a quick note now protects your next ask.',
    people: '8',
    date: 'Wed Jun 17, 10:00 AM',
    duration: '~30 min',
    action: 'Open donor list',
  },
]

const Meta = ({
  icon: Icon,
  children,
}: {
  icon: LucideIcon
  children: string
}) => (
  <span className="text-muted-foreground flex items-center gap-1.5 text-xs">
    <Icon className="size-3.5" />
    {children}
  </span>
)

export const CampaignManager = () => {
  const [activeIndex, setActiveIndex] = useState(0)
  const cardRefs = useRef<Array<HTMLDivElement | null>>([])

  // Scroll-driven focus: the task card crossing the viewport center gets the
  // highlight. IntersectionObserver is browser-driven, works with any scroller.
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return
          const idx = cardRefs.current.indexOf(entry.target as HTMLDivElement)
          if (idx !== -1) setActiveIndex(idx)
        })
      },
      { rootMargin: '-45% 0px -45% 0px', threshold: 0 },
    )
    cardRefs.current.forEach((el) => el && observer.observe(el))
    return () => observer.disconnect()
  }, [])

  return (
    <ScreenLayout
      title="Campaign Manager"
      aiPlaceholder="Hi Renee, how can I help?"
    >
      <Card className="gap-3 p-5">
        <div className="text-muted-foreground flex items-center gap-1.5 text-xs font-medium">
          Likely voters
          <Info className="size-3.5" />
        </div>
        <p className="text-foreground text-2xl font-semibold">
          {LIKELY.toLocaleString()}{' '}
          <span className="text-muted-foreground text-base font-normal">
            / {NEEDED.toLocaleString()} votes needed to win
          </span>
        </p>
        <Progress value={(LIKELY / NEEDED) * 100} />
      </Card>

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-foreground text-lg font-semibold">
            Your prioritized tasks this week
          </h2>
          <Button
            variant="ghost"
            size="small"
            className="text-muted-foreground"
          >
            <Archive className="size-4" />
            Archive
          </Button>
        </div>

        <div className="space-y-3">
          {TASKS.map((task, i) => {
            const Icon = task.categoryIcon
            return (
              <div
                key={task.title}
                ref={(el) => {
                  cardRefs.current[i] = el
                }}
              >
                <ContentCard
                  className={cn(
                    'transition-colors',
                    activeIndex === i && 'border-primary',
                  )}
                  eyebrow={task.category}
                  eyebrowIcon={<Icon />}
                  title={task.title}
                  description={task.blurb}
                  primaryAction={{ label: task.action }}
                >
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
                    <Meta icon={Users}>{task.people}</Meta>
                    <Meta icon={Calendar}>{task.date}</Meta>
                    <Meta icon={Clock}>{task.duration}</Meta>
                  </div>
                </ContentCard>
              </div>
            )
          })}
        </div>
      </section>
    </ScreenLayout>
  )
}
