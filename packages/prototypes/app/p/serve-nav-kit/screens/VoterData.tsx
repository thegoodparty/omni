'use client'

import { Search, Plus, Sparkles, Users } from 'lucide-react'
import { Button, ContentCard, Input } from '@goodparty_org/styleguide'
import { ScreenLayout } from '../components/ScreenLayout'
import { StatRows } from '../components/Stats'

const UNIVERSE = [
  { label: 'Voters in your district', value: '118,099' },
  { label: 'Projected turnout', value: '42,318' },
  { label: 'Voters needed to win', value: '21,160' },
]

const LISTS = [
  {
    title: 'Local jobs & wages',
    description:
      'Working families who care about paychecks and cost of living.',
    count: '42,468',
  },
  {
    title: 'Housing affordability',
    description: 'Voters who have housing affordability as a top priority.',
    count: '32,878',
  },
  {
    title: 'Public safety',
    description:
      'Voters focused on policing, response times, and safe streets.',
    count: '28,540',
  },
]

export const VoterData = () => (
  <ScreenLayout
    title="Voter Data"
    aiPlaceholder="Describe the list you want and I'll make it for you"
    subContent={
      <div className="w-full max-w-md">
        <Input icon={<Search />} placeholder="Search for any voter contact" />
      </div>
    }
    actions={
      <Button size="small">
        <Plus className="size-4" />
        Create new list
      </Button>
    }
  >
    <section className="space-y-3">
      <div>
        <h2 className="text-foreground text-lg font-semibold">
          Your Voter Universe
        </h2>
        <p className="text-muted-foreground text-sm">
          Find voters in Durham, NC District 20 likely to move your race and
          then reach them.
        </p>
      </div>
      <StatRows rows={UNIVERSE} />
    </section>

    <section className="space-y-3">
      <div>
        <h2 className="text-foreground text-lg font-semibold">
          Recommended voter lists
        </h2>
        <p className="text-muted-foreground text-sm">
          Voter lists in your district likely to be supportive of your campaign.
        </p>
      </div>
      <div className="space-y-3">
        {LISTS.map((list) => (
          <ContentCard
            key={list.title}
            eyebrow="Recommended"
            eyebrowIcon={<Sparkles />}
            title={list.title}
            description={list.description}
            primaryAction={{ label: 'Send outreach' }}
            secondaryAction={{ label: 'Details' }}
          >
            <div className="text-muted-foreground flex items-center gap-1.5 text-sm">
              <Users className="size-4" />
              {list.count}
            </div>
          </ContentCard>
        ))}
      </div>
    </section>
  </ScreenLayout>
)
