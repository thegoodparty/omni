import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { useArgs } from 'storybook/preview-api'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
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
}

export const Playground: StoryObj<PlaygroundArgs> = {
  args: {
    open: false,
    side: 'top',
    delayDuration: 200,
  },
  argTypes: {
    open: {
      control: 'boolean',
      description: 'Controlled open state.',
    },
    side: {
      control: 'select',
      options: ['top', 'right', 'bottom', 'left'],
    },
    delayDuration: {
      control: { type: 'number', min: 0, max: 2000, step: 50 },
      description: 'Delay before the tooltip appears, in ms.',
    },
  },
  render: ({ open, side, delayDuration }) => {
    const [, updateArgs] = useArgs()
    return (
      <TooltipProvider delayDuration={delayDuration}>
        <Tooltip
          open={open}
          onOpenChange={(next) => updateArgs({ open: next })}
        >
          <TooltipTrigger asChild>
            <Button variant="outline">Hover me</Button>
          </TooltipTrigger>
          <TooltipContent side={side}>
            <p>Add to library</p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    )
  },
}

export const Default: Story = {
  render: () => (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button variant="outline">Hover me</Button>
        </TooltipTrigger>
        <TooltipContent>
          <p>Add to library</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  ),
}

export const WithIcon: Story = {
  render: () => (
    <TooltipProvider>
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
    </TooltipProvider>
  ),
}

export const Multiple: Story = {
  render: () => (
    <TooltipProvider>
      <div className="flex gap-4">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="outline">Copy</Button>
          </TooltipTrigger>
          <TooltipContent>
            <p>Copy to clipboard</p>
          </TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="outline">Share</Button>
          </TooltipTrigger>
          <TooltipContent>
            <p>Share with others</p>
          </TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="outline">Delete</Button>
          </TooltipTrigger>
          <TooltipContent>
            <p>Delete permanently</p>
          </TooltipContent>
        </Tooltip>
      </div>
    </TooltipProvider>
  ),
}

export const OpenOnClick: Story = {
  render: () => (
    <Tooltip openOnClick disableHoverableContent>
      <TooltipTrigger className="cursor-pointer underline decoration-dotted">
        Campaign plan
      </TooltipTrigger>
      <TooltipContent
        side="top"
        align="start"
        sideOffset={8}
        showArrow={false}
        className="flex w-80 items-start gap-4 rounded-xl bg-white p-4 text-components-card-foreground shadow-md"
      >
        <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-brand-bright-yellow-200">
          <StarIcon className="h-6 w-6" />
        </span>
        <span className="flex flex-col gap-2">
          <span className="text-xl font-semibold leading-7">Campaign plan</span>
          <span className="text-base font-normal leading-6">
            Opens on hover and keyboard focus; click/tap toggles it (a second
            tap dismisses). `showArrow=false` plus a `sideOffset` keeps a gap
            between the trigger and the card.
          </span>
        </span>
      </TooltipContent>
    </Tooltip>
  ),
}

export const WithCustomContent: Story = {
  render: () => (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button variant="outline">Custom content</Button>
        </TooltipTrigger>
        <TooltipContent className="w-80">
          <div className="space-y-2">
            <h4 className="font-medium">Custom tooltip</h4>
            <p className="text-sm text-muted-foreground">
              This tooltip has custom content with a title and description.
            </p>
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  ),
}
