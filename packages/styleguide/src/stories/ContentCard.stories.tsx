import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { ContentCard } from '../components/ui/content-card'
import {
  UsersRoundIcon,
  InfoIcon,
  MegaphoneIcon,
  ChevronRightIcon,
} from '../components/ui/icons'
import { Badge } from '../components/ui/badge'

const meta: Meta<typeof ContentCard> = {
  title: 'Components/ContentCard',
  component: ContentCard,
  parameters: { layout: 'padded' },
  tags: ['autodocs'],
}

export default meta
type Story = StoryObj<typeof ContentCard>

type BadgeVariant = 'default' | 'secondary' | 'soft' | 'destructive' | 'outline'

type PlaygroundArgs = {
  eyebrow: string
  eyebrowEmphasis: boolean
  showEyebrowIcon: boolean
  title: string
  description: string
  helper: 'none' | 'info' | 'badge'
  helperBadgeText: string
  helperBadgeVariant: BadgeVariant
  showContent: boolean
  actions: 'none' | 'single' | 'multiple'
}

const helperNode = (
  helper: 'none' | 'info' | 'badge',
  badgeText: string,
  badgeVariant: BadgeVariant,
) => {
  if (helper === 'info') return <InfoIcon />
  if (helper === 'badge')
    return <Badge variant={badgeVariant}>{badgeText}</Badge>
  return undefined
}

export const Playground: StoryObj<PlaygroundArgs> = {
  args: {
    eyebrow: 'Top Issues',
    eyebrowEmphasis: true,
    showEyebrowIcon: true,
    title: 'Affordable Housing',
    description:
      'A short description that explains the card in one or two lines.',
    helper: 'badge',
    helperBadgeText: '895 constituents',
    helperBadgeVariant: 'soft',
    showContent: true,
    actions: 'multiple',
  },
  argTypes: {
    eyebrow: { control: 'text', description: 'Eyebrow label. Empty hides it.' },
    eyebrowEmphasis: {
      control: 'boolean',
      description: 'Render the eyebrow in primary blue (Figma "Primary").',
    },
    showEyebrowIcon: { control: 'boolean' },
    title: { control: 'text' },
    description: { control: 'text' },
    helper: {
      control: 'select',
      options: ['none', 'info', 'badge'],
      description: 'Trailing header slot. "badge" renders the Badge component.',
    },
    helperBadgeText: {
      control: 'text',
      description: 'Text for the helper badge (e.g. a count or category).',
      if: { arg: 'helper', eq: 'badge' },
    },
    helperBadgeVariant: {
      control: 'select',
      options: ['default', 'secondary', 'soft', 'destructive', 'outline'],
      description: 'Badge variant for the helper badge.',
      if: { arg: 'helper', eq: 'badge' },
    },
    showContent: {
      control: 'boolean',
      description: 'Render the content slot (children).',
    },
    actions: {
      control: 'select',
      options: ['none', 'single', 'multiple'],
      description:
        'Footer actions. Secondary uses the neutral button, primary uses the default blue button. Stacks full-width under 600px.',
    },
  },
  render: ({
    eyebrow,
    eyebrowEmphasis,
    showEyebrowIcon,
    title,
    description,
    helper,
    helperBadgeText,
    helperBadgeVariant,
    showContent,
    actions,
  }) => (
    <ContentCard
      className="w-[560px] max-w-full"
      eyebrow={eyebrow || undefined}
      eyebrowEmphasis={eyebrowEmphasis}
      eyebrowIcon={showEyebrowIcon ? <UsersRoundIcon /> : undefined}
      title={title}
      description={description}
      helper={helperNode(helper, helperBadgeText, helperBadgeVariant)}
      secondaryAction={actions === 'multiple' ? { label: 'Skip' } : undefined}
      primaryAction={actions === 'none' ? undefined : { label: 'See details' }}
    >
      {showContent ? (
        <div className="text-muted-foreground border-base-border flex h-16 items-center justify-center rounded-lg border border-dashed text-sm">
          Content slot
        </div>
      ) : null}
    </ContentCard>
  ),
}

export const Variants: Story = {
  parameters: { controls: { disable: true } },
  render: () => (
    <div className="flex max-w-[560px] flex-col gap-4">
      <ContentCard
        eyebrow="Top Issues"
        eyebrowIcon={<UsersRoundIcon />}
        title="Affordable Housing"
        description="A short description that explains the card in one or two lines."
        helper={<InfoIcon />}
        secondaryAction={{ label: 'Skip' }}
        primaryAction={{ label: 'See details' }}
      />
      <ContentCard
        eyebrow="Messaging"
        eyebrowEmphasis={false}
        eyebrowIcon={<MegaphoneIcon />}
        helper={<Badge variant="soft">895 constituents</Badge>}
        title="Post a photo from the Farmers Market"
        description="A short description that explains the card in one or two lines."
        primaryAction={{ label: 'See details' }}
      />
      <ContentCard
        title="Affordable Housing"
        description="A short description that explains the card in one or two lines."
        helper={<ChevronRightIcon />}
      />
    </div>
  ),
}

export const Actions: Story = {
  parameters: { controls: { disable: true } },
  render: () => (
    <div className="flex max-w-[560px] flex-col gap-4">
      <ContentCard
        eyebrow="No actions"
        title="Affordable Housing"
        description="A short description that explains the card in one or two lines."
      />
      <ContentCard
        eyebrow="Single action"
        title="Affordable Housing"
        description="A short description that explains the card in one or two lines."
        primaryAction={{ label: 'See details' }}
      />
      <ContentCard
        eyebrow="Multiple actions"
        title="Affordable Housing"
        description="A short description that explains the card in one or two lines."
        secondaryAction={{ label: 'Skip' }}
        primaryAction={{ label: 'See details' }}
      />
    </div>
  ),
}

export const WithContent: Story = {
  parameters: { controls: { disable: true } },
  render: () => (
    <ContentCard
      className="w-[560px] max-w-full"
      eyebrow="Top Issues"
      eyebrowIcon={<UsersRoundIcon />}
      title="Affordable Housing"
      description="A short description that explains the card in one or two lines."
      secondaryAction={{ label: 'Skip' }}
      primaryAction={{ label: 'See details' }}
    >
      <div className="text-muted-foreground border-base-border flex h-20 items-center justify-center rounded-lg border border-dashed text-sm">
        Drop any content here — a chart, a list, a stat
      </div>
    </ContentCard>
  ),
}

export const ResponsiveFooter: Story = {
  parameters: {
    controls: { disable: true },
    viewport: { defaultViewport: 'mobile1' },
  },
  render: () => (
    <div className="flex max-w-[560px] flex-col gap-2">
      <p className="text-muted-foreground text-sm">
        Under 600px the footer actions stack and go full-width. Use the viewport
        toolbar (or narrow the window) to see it.
      </p>
      <ContentCard
        eyebrow="Top Issues"
        eyebrowIcon={<UsersRoundIcon />}
        title="Affordable Housing"
        description="A short description that explains the card in one or two lines."
        secondaryAction={{ label: 'Skip' }}
        primaryAction={{ label: 'See details' }}
      />
    </div>
  ),
}
