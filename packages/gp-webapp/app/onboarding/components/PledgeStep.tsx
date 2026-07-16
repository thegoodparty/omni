'use client'

import { Flag, User, UsersRound } from 'lucide-react'
import { Card, CardContent } from '@styleguide'
import { getMarketingUrl } from 'helpers/linkhelper'

const PLEDGE_ITEMS = [
  {
    title: 'Independent',
    Icon: User,
    body: 'I will run and serve as a non-partisan, independent or third party candidate, not as a Democrat or Republican. I will not accept endorsements from either the Republican or Democratic party.',
  },
  {
    title: 'People-First',
    Icon: UsersRound,
    body: 'I get a majority of my funding from individuals, not from political action committees (PACs), lobbies, unions or corporations. I do not accept funding from either the Republican or Democratic party. Once elected, I will focus on solving the problems facing my constituents, not serving myself or special interests.',
  },
  {
    title: 'Anti-Corruption',
    Icon: Flag,
    body: 'I will always uphold the highest level of integrity by being open, transparent and accountable about my donors, positions and progress. I only serve the people, so I will use the best tools and data available to stay connected and responsive to my constituents.',
  },
] as const

export const PledgeStep = (): React.JSX.Element => (
  <Card className="rounded-2xl border-base-border shadow-none">
    <CardContent className="space-y-6 px-6 py-4 sm:px-8 sm:py-5">
      <p className="text-2xl sm:text-3xl font-bold leading-[1.08] text-foreground">
        I pledge to be...
      </p>

      <ul className="space-y-6">
        {PLEDGE_ITEMS.map(({ title, Icon, body }) => (
          <li key={title} className="flex flex-col gap-2">
            <div className="flex items-center gap-3">
              <Icon
                className="size-7 shrink-0 text-foreground"
                aria-hidden="true"
              />
              <h3 className="text-xl font-semibold text-foreground">{title}</h3>
            </div>
            <p className="text-sm text-muted-foreground">{body}</p>
          </li>
        ))}
      </ul>

      <p className="border-t border-base-border pt-4 text-xs text-muted-foreground">
        By continuing, you agree to run a civil campaign focused on issues, not
        mudslinging or ad hominem attacks; also accepting GoodParty.org&apos;s{' '}
        <a
          href={getMarketingUrl('/terms-of-service')}
          target="_blank"
          rel="noopener noreferrer"
          className="underline"
        >
          Terms of Service
        </a>{' '}
        and{' '}
        <a
          href={getMarketingUrl('/privacy')}
          target="_blank"
          rel="noopener noreferrer"
          className="underline"
        >
          Privacy Policy
        </a>
        .
      </p>
    </CardContent>
  </Card>
)
