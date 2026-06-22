import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { useArgs } from 'storybook/preview-api'
import {
  Sheet,
  SheetBody,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '../components/ui/sheet'
import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'
import { Label } from '../components/ui/label'
import { cn } from '@styleguide/lib/utils'

const meta: Meta<typeof Sheet> = {
  title: 'Components/Sheet',
  component: Sheet,
  tags: ['autodocs'],
}

export default meta

const sectionLabel =
  'text-muted-foreground text-xs font-medium uppercase tracking-wide'

type PlaygroundArgs = {
  open: boolean
  side: 'top' | 'right' | 'bottom' | 'left'
}

export const Playground: StoryObj<PlaygroundArgs> = {
  args: {
    open: false,
    side: 'right',
  },
  argTypes: {
    open: {
      control: 'boolean',
      description: 'Controlled open state.',
    },
    side: {
      control: 'select',
      options: ['top', 'right', 'bottom', 'left'],
      description: 'Side the sheet slides in from.',
    },
  },
  render: ({ open, side }) => {
    const [, updateArgs] = useArgs()
    return (
      <Sheet open={open} onOpenChange={(next) => updateArgs({ open: next })}>
        <SheetTrigger asChild>
          <Button variant="outline">Open Sheet</Button>
        </SheetTrigger>
        <SheetContent side={side}>
          <SheetHeader>
            <SheetTitle>Edit profile</SheetTitle>
            <SheetDescription>
              Make changes to your profile here. Click save when you&apos;re
              done.
            </SheetDescription>
          </SheetHeader>
          <SheetBody>
            <div className="grid gap-2">
              <Label htmlFor="playground-name">Name</Label>
              <Input id="playground-name" defaultValue="Pedro Duarte" />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="playground-username">Username</Label>
              <Input id="playground-username" defaultValue="@peduarte" />
            </div>
          </SheetBody>
          <SheetFooter>
            <SheetClose asChild>
              <Button variant="outline">Cancel</Button>
            </SheetClose>
            <Button>Save changes</Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    )
  },
}

export const Sides: StoryObj<typeof Sheet> = {
  parameters: { controls: { disable: true } },
  render: () => (
    <div className="flex flex-col gap-4">
      <p className={sectionLabel}>Direction</p>
      <div className="flex gap-4 flex-wrap">
        {(['right', 'left', 'top', 'bottom'] as const).map((side) => (
          <Sheet key={side}>
            <SheetTrigger asChild>
              <Button variant="outline">Open {side}</Button>
            </SheetTrigger>
            <SheetContent side={side}>
              <SheetHeader>
                <SheetTitle>Side: {side}</SheetTitle>
                <SheetDescription>
                  Sheet sliding in from the {side}.
                </SheetDescription>
              </SheetHeader>
            </SheetContent>
          </Sheet>
        ))}
      </div>
    </div>
  ),
}

export const Overflow: StoryObj<typeof Sheet> = {
  parameters: { controls: { disable: true } },
  render: () => (
    <Sheet>
      <SheetTrigger asChild>
        <Button variant="outline">Open Sheet</Button>
      </SheetTrigger>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>Long content</SheetTitle>
          <SheetDescription>
            SheetBody scrolls independently — header and footer stay fixed.
          </SheetDescription>
        </SheetHeader>
        <SheetBody>
          {Array.from({ length: 12 }, (_, i) => (
            <div key={i} className="grid gap-2">
              <Label htmlFor={`overflow-field-${i}`}>Field {i + 1}</Label>
              <Input
                id={`overflow-field-${i}`}
                placeholder={`Value ${i + 1}`}
              />
            </div>
          ))}
        </SheetBody>
        <SheetFooter>
          <SheetClose asChild>
            <Button variant="outline">Cancel</Button>
          </SheetClose>
          <Button>Save changes</Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  ),
}

export const Anatomy: StoryObj<typeof Sheet> = {
  parameters: { controls: { disable: true } },
  render: () => (
    <Sheet defaultOpen>
      <SheetTrigger asChild>
        <Button variant="outline">Open Sheet</Button>
      </SheetTrigger>
      <SheetContent>
        <SheetHeader>
          <p className={sectionLabel}>SheetHeader</p>
          <SheetTitle>SheetTitle</SheetTitle>
          <SheetDescription>
            SheetDescription — supporting text below the title.
          </SheetDescription>
        </SheetHeader>
        <SheetBody className="gap-2">
          <p className={sectionLabel}>Content area</p>
          <div className="grid gap-2">
            <Label htmlFor="anatomy-name">Name</Label>
            <Input id="anatomy-name" placeholder="Enter name" />
          </div>
        </SheetBody>
        <p className={cn(sectionLabel, 'px-6')}>SheetFooter</p>
        <SheetFooter>
          <SheetClose asChild>
            <Button variant="outline">SheetClose</Button>
          </SheetClose>
          <Button>Primary action</Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  ),
}
