import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '../components/ui/accordion'

const meta: Meta<typeof Accordion> = {
  title: 'Components/Accordion',
  component: Accordion,
  tags: ['autodocs'],
  argTypes: {
    type: {
      control: {
        type: 'inline-radio',
        labels: { single: 'One at a time', multiple: 'Multiple at once' },
      },
      options: ['single', 'multiple'],
      description:
        '"One at a time" collapses any open item when you open another. "Multiple at once" lets any number of items stay open simultaneously.',
    },
    collapsible: {
      control: 'boolean',
      description:
        'Allow closing the active item by clicking it again. Only applies when type is "One at a time".',
      if: { arg: 'type', eq: 'single' },
    },
    size: {
      control: 'inline-radio',
      options: ['default', 'sm'],
      description:
        'Controls trigger and content padding. Use "sm" in sidebars or compact layouts.',
    },
    disabled: {
      control: 'boolean',
      description: 'Disable all items in the accordion.',
    },
  },
}

export default meta
type Story = StoryObj<typeof Accordion>

const items = [
  {
    value: 'item-1',
    question: 'What is GoodParty.org?',
    answer:
      'GoodParty.org is a nonpartisan civic tech organization that helps independent candidates run, win, and serve free from party affiliation and donor influence.',
  },
  {
    value: 'item-2',
    question: 'Who can use the platform?',
    answer:
      'Any independent candidate running for local, state, or federal office is welcome to use our tools to organize a campaign.',
  },
  {
    value: 'item-3',
    question: 'How much does it cost?',
    answer:
      'The core platform is free. Pro features are available for candidates who need additional outreach and AI capabilities.',
  },
]

export const Playground: Story = {
  args: {
    type: 'single',
    collapsible: true,
    size: 'default',
    disabled: false,
  },
  render: ({ disabled, collapsible, ...rootArgs }) => (
    <Accordion
      {...rootArgs}
      {...(rootArgs.type === 'single' ? { collapsible } : {})}
      className="w-full"
    >
      {items.map(({ value, question, answer }) => (
        <AccordionItem key={value} value={value} disabled={disabled}>
          <AccordionTrigger>{question}</AccordionTrigger>
          <AccordionContent>{answer}</AccordionContent>
        </AccordionItem>
      ))}
    </Accordion>
  ),
}

export const States: Story = {
  parameters: { controls: { disable: true } },
  render: () => (
    <div className="flex w-full flex-col gap-10">
      <div>
        <p className="mb-2 text-sm text-muted-foreground">
          Default — all closed
        </p>
        <Accordion type="single" collapsible className="w-full">
          {items.map(({ value, question, answer }) => (
            <AccordionItem key={value} value={value}>
              <AccordionTrigger>{question}</AccordionTrigger>
              <AccordionContent>{answer}</AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      </div>

      <div>
        <p className="mb-2 text-sm text-muted-foreground">
          One pre-opened (defaultValue)
        </p>
        <Accordion
          type="single"
          collapsible
          defaultValue="item-1"
          className="w-full"
        >
          {items.map(({ value, question, answer }) => (
            <AccordionItem key={value} value={value}>
              <AccordionTrigger>{question}</AccordionTrigger>
              <AccordionContent>{answer}</AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      </div>

      <div>
        <p className="mb-2 text-sm text-muted-foreground">
          Multiple at once — two open
        </p>
        <Accordion
          type="multiple"
          defaultValue={['item-1', 'item-3']}
          className="w-full"
        >
          {items.map(({ value, question, answer }) => (
            <AccordionItem key={value} value={value}>
              <AccordionTrigger>{question}</AccordionTrigger>
              <AccordionContent>{answer}</AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      </div>

      <div>
        <p className="mb-2 text-sm text-muted-foreground">
          Disabled item (item 2)
        </p>
        <Accordion type="single" collapsible className="w-full">
          {items.map(({ value, question, answer }) => (
            <AccordionItem
              key={value}
              value={value}
              disabled={value === 'item-2'}
            >
              <AccordionTrigger>{question}</AccordionTrigger>
              <AccordionContent>{answer}</AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      </div>

      <div>
        <p className="mb-2 text-sm text-muted-foreground">
          Compact (<code>{'size="sm"'}</code>)
        </p>
        <Accordion type="single" collapsible size="sm" className="w-full">
          {items.map(({ value, question, answer }) => (
            <AccordionItem key={value} value={value}>
              <AccordionTrigger>{question}</AccordionTrigger>
              <AccordionContent>{answer}</AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      </div>
    </div>
  ),
}
