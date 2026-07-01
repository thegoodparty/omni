import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { SourceCitation } from '../components/ui/source-citation'

const meta: Meta<typeof SourceCitation> = {
  component: SourceCitation,
  title: 'Components/SourceCitation',
  parameters: { layout: 'centered' },
  tags: ['autodocs'],
  argTypes: {
    organizationLogo: { table: { disable: true } },
    className: { table: { disable: true } },
  },
}
export default meta

type Story = StoryObj<typeof SourceCitation>

export const Playground: Story = {
  args: {
    organization: 'Pew Research Center',
    title: 'Voter turnout reached a modern high in 2020',
    description:
      'Analysis of validated voter files showing turnout trends across demographic groups over recent general elections.',
    url: 'https://www.pewresearch.org/',
    chipLabel: '',
    internalFooter: 'Internal data — not publicly linkable.',
  },
  argTypes: {
    organization: {
      control: 'text',
      description: 'Name of the cited source organization.',
    },
    title: { control: 'text', description: 'Headline of the cited material.' },
    description: {
      control: 'text',
      description:
        'Summary shown in the expanded popover (desktop) / drawer (mobile).',
    },
    url: {
      control: 'text',
      description:
        'Source URL. When set, the citation is external — chip shows the favicon + domain and the title links out. Leave empty for an internal/proprietary source.',
    },
    chipLabel: {
      control: 'text',
      description:
        'Optional chip label override. Defaults to the domain (external) or "{organization} internal data" (internal).',
    },
    internalFooter: {
      control: 'text',
      description:
        'Footer text for an internal source. Only shown when url is empty.',
      if: { arg: 'url', truthy: false },
    },
  },
  // The chip expands on hover/click; an empty chipLabel control should fall
  // back to the derived label rather than render a blank chip.
  render: ({ chipLabel, ...args }) => (
    <SourceCitation {...args} chipLabel={chipLabel || undefined} />
  ),
}

export const Variants: Story = {
  parameters: { controls: { disable: true } },
  render: () => (
    <div className="flex flex-wrap items-center gap-4">
      <SourceCitation
        organization="Pew Research Center"
        title="Voter turnout reached a modern high in 2020"
        description="Analysis of validated voter files showing turnout trends across demographic groups."
        url="https://www.pewresearch.org/"
      />
      <SourceCitation
        organization="GoodParty"
        title="District voter model"
        description="Internal modeling of likely supporters built from the campaign's voter file."
      />
    </div>
  ),
}
