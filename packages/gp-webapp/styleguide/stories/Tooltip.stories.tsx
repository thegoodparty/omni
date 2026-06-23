import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { expect, userEvent, within } from 'storybook/test'
import { useArgs } from 'storybook/preview-api'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '../components/ui/tooltip'
import { Button } from '../components/ui/button'
import { StarIcon } from '../components/ui/icons'

const meta: Meta<typeof Tooltip> = {
  title: 'Components/Tooltip',
  component: Tooltip,
  tags: ['autodocs'],
}

export default meta
type Story = StoryObj<typeof Tooltip>

type PlaygroundArgs = {
  open: boolean
  side: 'top' | 'right' | 'bottom' | 'left'
  delayDuration: number
  content: string
  openOnClick: boolean
}

export const Playground: StoryObj<PlaygroundArgs> = {
  args: {
    open: true,
    side: 'top',
    delayDuration: 200,
    content: 'Add to library',
    openOnClick: false,
  },
  argTypes: {
    open: {
      control: 'boolean',
      description: 'Controlled open state.',
      if: { arg: 'openOnClick', truthy: false },
    },
    side: {
      control: 'select',
      options: ['top', 'right', 'bottom', 'left'],
    },
    delayDuration: {
      control: { type: 'number', min: 0, max: 2000, step: 50 },
      description: 'Delay before the tooltip appears, in ms.',
    },
    content: {
      control: 'text',
      description: 'Tooltip text content.',
    },
    openOnClick: {
      control: 'boolean',
      description: 'Also open on click/tap — useful for touch devices.',
    },
  },
  render: ({ open, side, delayDuration, content, openOnClick }) => {
    const [, updateArgs] = useArgs()
    return (
      <div className="flex items-center justify-center py-16">
        <Tooltip
          {...(!openOnClick
            ? { open, onOpenChange: (next) => updateArgs({ open: next }) }
            : {})}
          openOnClick={openOnClick}
          delayDuration={delayDuration}
        >
          <TooltipTrigger asChild>
            <Button variant="outline">Hover me</Button>
          </TooltipTrigger>
          <TooltipContent side={side}>
            <p>{content}</p>
          </TooltipContent>
        </Tooltip>
      </div>
    )
  },
}

export const TriggerTypes: Story = {
  parameters: { controls: { disable: true } },
  render: () => (
    <div className="flex gap-4">
      <Tooltip>
        <TooltipTrigger asChild>
          <Button variant="outline">Hover me</Button>
        </TooltipTrigger>
        <TooltipContent>
          <p>Add to library</p>
        </TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button variant="ghost" size="small">
            <StarIcon className="size-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          <p>Add to favorites</p>
        </TooltipContent>
      </Tooltip>
    </div>
  ),
}

export const Sides: Story = {
  parameters: { controls: { disable: true } },
  render: () => (
    <div className="grid grid-cols-2 place-items-center gap-16 py-8">
      {(['top', 'bottom', 'left', 'right'] as const).map((side) => (
        <Tooltip key={side} open>
          <TooltipTrigger asChild>
            <Button variant="outline" className="capitalize">
              {side}
            </Button>
          </TooltipTrigger>
          <TooltipContent side={side}>
            <p>Tooltip on {side}</p>
          </TooltipContent>
        </Tooltip>
      ))}
    </div>
  ),
}

export const Disabled: Story = {
  parameters: { controls: { disable: true } },
  render: () => (
    <div className="flex items-center justify-center py-16">
      <Tooltip>
        <TooltipTrigger asChild>
          <span tabIndex={0} className="inline-flex">
            <Button variant="outline" disabled className="pointer-events-none">
              Disabled action
            </Button>
          </span>
        </TooltipTrigger>
        <TooltipContent>
          <p>You don&apos;t have permission to do this</p>
        </TooltipContent>
      </Tooltip>
    </div>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const span = canvas.getByText('Disabled action').closest('span')!
    await userEvent.hover(span)
    await expect(
      within(document.body).findByText("You don't have permission to do this"),
    ).resolves.toBeVisible()
  },
}

export const OpenOnClick: Story = {
  parameters: { controls: { disable: true } },
  render: () => (
    <div className="flex items-center justify-center py-16">
      <Tooltip openOnClick disableHoverableContent>
        <TooltipTrigger className="cursor-pointer text-foreground underline decoration-dotted">
          Campaign plan
        </TooltipTrigger>
        <TooltipContent side="top">
          <p>Opens on hover and tap — tap again to dismiss.</p>
        </TooltipContent>
      </Tooltip>
    </div>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByText('Campaign plan'))
    await expect(
      within(document.body).findByText(
        'Opens on hover and tap — tap again to dismiss.',
      ),
    ).resolves.toBeVisible()
  },
}

export const RichContent: Story = {
  parameters: { controls: { disable: true } },
  render: () => (
    <div className="flex items-center justify-center py-48">
      <Tooltip open>
        <TooltipTrigger className="cursor-pointer text-foreground underline decoration-dotted">
          Campaign plan
        </TooltipTrigger>
        <TooltipContent
          side="top"
          align="center"
          sideOffset={8}
          showArrow={false}
          className="flex w-80 items-start gap-4 rounded-xl border border-border bg-card p-4 text-card-foreground shadow-lg"
        >
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-muted">
            <StarIcon className="h-5 w-5" />
          </span>
          <span className="flex flex-col gap-1">
            <span className="text-sm font-semibold">Campaign plan</span>
            <span className="text-sm font-normal text-muted-foreground">
              A step-by-step guide to help you run a winning campaign — from
              filing to election day.
            </span>
          </span>
        </TooltipContent>
      </Tooltip>
    </div>
  ),
}
