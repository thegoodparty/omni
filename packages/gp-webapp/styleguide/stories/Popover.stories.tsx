import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { useArgs } from 'storybook/preview-api'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '../components/ui/popover'
import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'
import { Label } from '../components/ui/label'
import { InfoIcon } from '../components/ui/icons'

const meta: Meta<typeof Popover> = {
  title: 'Components/Popover',
  component: Popover,
  tags: ['autodocs'],
}

export default meta

type PlaygroundArgs = {
  open: boolean
  side: 'top' | 'right' | 'bottom' | 'left'
  align: 'start' | 'center' | 'end'
}

export const Playground: StoryObj<PlaygroundArgs> = {
  args: {
    open: false,
    side: 'bottom',
    align: 'center',
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
    align: {
      control: 'inline-radio',
      options: ['start', 'center', 'end'],
    },
  },
  render: ({ open, side, align }) => {
    const [, updateArgs] = useArgs()
    return (
      <div className="flex h-[300px] items-center justify-center">
        <Popover
          open={open}
          onOpenChange={(next) => updateArgs({ open: next })}
        >
          <PopoverTrigger asChild>
            <Button variant="outline">Open popover</Button>
          </PopoverTrigger>
          <PopoverContent className="w-80" side={side} align={align}>
            <div className="space-y-2">
              <h4 className="font-medium leading-none">Dimensions</h4>
              <p className="text-sm text-muted-foreground">
                Set the dimensions for the layer.
              </p>
            </div>
          </PopoverContent>
        </Popover>
      </div>
    )
  },
}

export const Triggers: StoryObj<typeof Popover> = {
  parameters: { controls: { disable: true } },
  render: () => (
    <div className="flex h-[300px] items-center justify-center gap-8">
      <Popover>
        <PopoverTrigger asChild>
          <Button variant="outline">Text trigger</Button>
        </PopoverTrigger>
        <PopoverContent className="w-72">
          <div className="space-y-2">
            <h4 className="font-medium leading-none">Details</h4>
            <p className="text-sm text-muted-foreground">
              Additional context about this item.
            </p>
          </div>
        </PopoverContent>
      </Popover>
      <Popover>
        <PopoverTrigger asChild>
          <Button variant="ghost" size="small">
            <InfoIcon className="size-4" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-72">
          <div className="space-y-2">
            <h4 className="font-medium leading-none">Details</h4>
            <p className="text-sm text-muted-foreground">
              Additional context about this item.
            </p>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  ),
}

export const Patterns: StoryObj<typeof Popover> = {
  parameters: { controls: { disable: true } },
  render: () => (
    <div className="flex h-[320px] items-center justify-center gap-8">
      <Popover>
        <PopoverTrigger asChild>
          <Button variant="outline">Info</Button>
        </PopoverTrigger>
        <PopoverContent className="w-72">
          <div className="space-y-2">
            <h4 className="font-medium leading-none">Information</h4>
            <p className="text-sm text-muted-foreground">
              A simple informational popover with a title and description.
            </p>
          </div>
        </PopoverContent>
      </Popover>
      <Popover>
        <PopoverTrigger asChild>
          <Button variant="outline">Form</Button>
        </PopoverTrigger>
        <PopoverContent className="w-80">
          <div className="space-y-4">
            <h4 className="font-medium leading-none">Settings</h4>
            <div className="space-y-2">
              <Label htmlFor="popover-width">Width</Label>
              <Input id="popover-width" placeholder="e.g. 320px" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="popover-height">Height</Label>
              <Input id="popover-height" placeholder="e.g. 240px" />
            </div>
            <Button className="w-full">Apply</Button>
          </div>
        </PopoverContent>
      </Popover>
      <Popover>
        <PopoverTrigger asChild>
          <Button variant="outline">Actions</Button>
        </PopoverTrigger>
        <PopoverContent className="w-48">
          <div className="flex flex-col gap-1">
            <Button variant="ghost" className="w-full justify-start">
              Edit
            </Button>
            <Button variant="ghost" className="w-full justify-start">
              Share
            </Button>
            <Button
              variant="ghost"
              className="w-full justify-start text-destructive"
            >
              Delete
            </Button>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  ),
}

export const Placement: StoryObj<typeof Popover> = {
  parameters: { controls: { disable: true } },
  render: () => (
    <div className="flex h-[320px] items-center justify-center gap-8">
      {(['top', 'right', 'bottom', 'left'] as const).map((side) => (
        <Popover key={side}>
          <PopoverTrigger asChild>
            <Button variant="outline" className="capitalize">
              {side}
            </Button>
          </PopoverTrigger>
          <PopoverContent side={side} className="w-40 p-3">
            <p className="text-center text-sm text-muted-foreground capitalize">
              {side}
            </p>
          </PopoverContent>
        </Popover>
      ))}
    </div>
  ),
}
