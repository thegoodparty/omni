'use client'

import type { ReactNode } from 'react'
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Card,
  ProBadge,
} from '@styleguide'
import {
  CheckIcon,
  ChevronRightIcon,
  CreditCardIcon,
  FileBadgeIcon,
  FileTextIcon,
  InfoIcon,
  ListIcon,
  LockIcon,
  SendIcon,
  WrenchIcon,
} from '@styleguide/components/ui/icons'

// Takeover-mode step furniture, copy verbatim from the Voter Outreach 2.0
// design (Voter Outreach.dc.html: PRO_COPY, PRO_CARDS, sgBody, selectCard,
// sgWhy). Rendered only under the takeover chrome; the legacy wizard keeps
// its own copy and markup.

export interface ProGateCopy {
  headline: string
  subhead: string
  cta: string
}

// Keyed by the `channel` search param the outreach tiles append. Channels
// without an entry fall back to the wizard's generic value-prop content.
export const PRO_GATE_COPY: Record<string, ProGateCopy> = {
  sms: {
    headline: 'Unlock text banking with Pro',
    subhead:
      'Texting real voters takes Pro. Your first campaign of up to 5,000 texts is free. $10/mo, cancel anytime.',
    cta: 'Upgrade to send my texts',
  },
  'phone-banking': {
    headline: 'Unlock phone banking with Pro',
    subhead: 'Calling real voters takes Pro. $10/mo, cancel anytime.',
    cta: 'Upgrade to start calling',
  },
  robocall: {
    headline: 'Unlock robocalls with Pro',
    subhead: 'Calling voters at scale takes Pro. $10/mo, cancel anytime.',
    cta: 'Upgrade to send my call',
  },
  'door-knocking': {
    headline: 'Unlock door knocking with Pro',
    subhead: 'Building your walk list takes Pro. $10/mo, cancel anytime.',
    cta: 'Upgrade to build my walk list',
  },
}

const PRO_VALUE_CARDS: { icon: ReactNode; title: string; body: string }[] = [
  {
    icon: <ListIcon className="size-4.5" />,
    title: 'Unlimited custom voter lists',
    body: 'The best voter data anywhere: Target super voters, or build your own list with 17 filters.',
  },
  {
    icon: <SendIcon className="size-4.5" />,
    title: 'Campaign-scale outreach',
    body: 'Reach thousands of voters from your kitchen table.',
  },
  {
    icon: <WrenchIcon className="size-4.5" />,
    title: 'Built for scrappy candidates',
    body: 'The full outreach toolkit, priced for a grassroots budget. $10/month, cancel anytime.',
  },
]

export const GATHER_ROWS: { icon: ReactNode; title: string; body: string }[] = [
  {
    icon: <FileBadgeIcon className="size-4.5" />,
    title: 'Your campaign EIN',
    body: 'Your campaign EIN helps verify your candidacy and comply with texting regulations.',
  },
  {
    icon: <FileTextIcon className="size-4.5" />,
    title: 'Your campaign filing details',
    body: 'Your election authority can provide these details to help verify your campaign.',
  },
  {
    icon: <CreditCardIcon className="size-4.5" />,
    title: 'Payment',
    body: 'Add your payment details to activate Pro at $10 per month. You can cancel any time.',
  },
]

// The 3-row bordered icon list (design: PRO_CARDS / overview rows).
export const IconRowList = ({
  rows,
}: {
  rows: { icon: ReactNode; title: string; body: string }[]
}) => (
  <Card className="gap-0 divide-y divide-border p-0 text-left">
    {rows.map((row) => (
      <div key={row.title} className="flex items-start gap-3 p-4">
        <span className="mt-0.5 shrink-0 text-primary">{row.icon}</span>
        <span className="min-w-0">
          <span className="block text-sm font-semibold">{row.title}</span>
          <span className="block text-[13px] text-muted-foreground">
            {row.body}
          </span>
        </span>
      </div>
    ))}
  </Card>
)

export const ProValueList = () => <IconRowList rows={PRO_VALUE_CARDS} />

// ProBadge + lock circle above the pause headline (design sgProHeader, the
// large centered variant).
export const ProLockBadge = () => (
  <div className="flex items-center justify-center gap-2">
    <ProBadge size="large" />
    <span
      aria-label="Locked"
      className="inline-flex size-7 shrink-0 items-center justify-center rounded-full bg-primary-light text-muted-foreground"
    >
      <LockIcon className="size-3.5" />
    </span>
  </div>
)

// "1 Upgrade to Pro › 2 Verify campaign" mini progress (design sgInterstitial).
export const UpgradeVerifySteps = () => (
  <div className="flex flex-wrap items-center justify-center gap-3">
    <span className="flex items-center gap-2.5">
      <span className="flex size-6.5 shrink-0 items-center justify-center rounded-full bg-primary text-[13px] font-semibold text-primary-foreground">
        1
      </span>
      <span className="text-sm font-semibold whitespace-nowrap">
        Upgrade to Pro
      </span>
    </span>
    <ChevronRightIcon className="size-4 shrink-0 text-muted-foreground" />
    <span className="flex items-center gap-2.5">
      <span className="flex size-6.5 shrink-0 items-center justify-center rounded-full border border-border text-[13px] font-semibold text-muted-foreground">
        2
      </span>
      <span className="text-sm font-medium whitespace-nowrap text-muted-foreground">
        Verify campaign
      </span>
    </span>
  </div>
)

// Design selectCard: bordered card, primary border + right check when active.
export const TakeoverSelectCard = ({
  selected,
  onClick,
  disabled = false,
  title,
  description,
}: {
  selected: boolean
  onClick: () => void
  disabled?: boolean
  title: string
  description: string
}) => (
  <button
    type="button"
    onClick={onClick}
    disabled={disabled}
    aria-pressed={selected}
    className={`flex w-full items-center justify-between gap-3 rounded-xl border bg-card p-4 text-left transition-colors disabled:pointer-events-none disabled:opacity-60 ${
      selected
        ? 'border-primary'
        : 'border-components-input-border hover:border-primary/50'
    }`}
  >
    <span className="min-w-0">
      <span className="block text-[15px] font-semibold">{title}</span>
      <span className="block text-[13px] text-muted-foreground">
        {description}
      </span>
    </span>
    {selected && <CheckIcon className="size-5 shrink-0 text-primary" />}
  </button>
)

// Design sgWhy: the info alert under a question step.
export const WhyWeAskAlert = ({ children }: { children: ReactNode }) => (
  <Alert variant="info" icon={<InfoIcon className="size-4" />} className="mt-5">
    <AlertTitle>Why we ask this</AlertTitle>
    <AlertDescription>{children}</AlertDescription>
  </Alert>
)
