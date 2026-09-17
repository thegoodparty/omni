import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { Overline } from '../components/ui/overline'

const meta: Meta<typeof Overline> = {
  title: 'Components/Overline',
  component: Overline,
  tags: ['autodocs'],
  parameters: {
    docs: {
      description: {
        component:
          'Small uppercase micro-label that names the block it sits above. Reserved for short text (a section name, a category, a flow identity) — never a full sentence. Text only by design: opening it to icons or badges dilutes the pattern.',
      },
    },
  },
}

export default meta
type Story = StoryObj<typeof Overline>

export const Playground: Story = {
  args: {
    children: 'Section label',
  },
  argTypes: {
    children: {
      name: 'Label',
      control: 'text',
    },
  },
  render: (args) => <Overline {...args} />,
}

// Common contexts an overline appears in.
export const InContext: Story = {
  parameters: { controls: { disable: true } },
  render: () => (
    <div className="flex flex-col gap-8">
      <div>
        <Overline>Assigned to</Overline>
        <p className="text-muted-foreground mt-2 text-sm">
          Sits above a section — names what follows without competing with the
          content's own heading.
        </p>
      </div>
      <div>
        <Overline>Create new list</Overline>
        <div className="bg-border mt-3 h-2.5 w-64 rounded-full" />
        <p className="text-muted-foreground mt-2 text-sm">
          Sits above the Stepper bars — names the flow.
        </p>
      </div>
    </div>
  ),
}
