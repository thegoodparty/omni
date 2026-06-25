import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { useArgs } from 'storybook/preview-api'
import {
  Drawer,
  DrawerBody,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHandle,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from '../components/ui/drawer'
import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'
import { Label } from '../components/ui/label'

const meta: Meta<typeof Drawer> = {
  title: 'Components/Drawer',
  component: Drawer,
  tags: ['autodocs'],
}

export default meta

type Direction = 'bottom' | 'top' | 'right' | 'left'

const directions: { value: Direction; label: string }[] = [
  { value: 'bottom', label: 'Bottom' },
  { value: 'top', label: 'Top' },
  { value: 'right', label: 'Right' },
  { value: 'left', label: 'Left' },
]

const hasHandle = (dir: Direction | undefined) => dir === 'bottom'

export const Playground: StoryObj<typeof Drawer> = {
  args: { open: false, direction: 'bottom' },
  argTypes: {
    open: { table: { disable: true } },
    direction: {
      control: 'select',
      options: ['bottom', 'right', 'top', 'left'],
      description: 'Slide direction.',
    },
  },
  render: ({ direction = 'bottom' }) => {
    const [{ open }, updateArgs] = useArgs()
    return (
      <Drawer
        open={open}
        direction={direction}
        onOpenChange={(next) => updateArgs({ open: next })}
      >
        <DrawerTrigger asChild>
          <Button variant="outline">Open Drawer</Button>
        </DrawerTrigger>
        <DrawerContent>
          {hasHandle(direction) && <DrawerHandle />}
          <DrawerHeader>
            <DrawerTitle>Drawer Title</DrawerTitle>
            <DrawerDescription>Drawer description text.</DrawerDescription>
          </DrawerHeader>
          <DrawerBody>
            <p>Drawer content goes here.</p>
          </DrawerBody>
          <DrawerFooter>
            <Button type="button">Submit</Button>
            <DrawerClose asChild>
              <Button type="button" variant="outline">
                Cancel
              </Button>
            </DrawerClose>
          </DrawerFooter>
        </DrawerContent>
      </Drawer>
    )
  },
}

export const WithForm: StoryObj = {
  parameters: { controls: { disable: true } },
  render: () => (
    <Drawer>
      <DrawerTrigger asChild>
        <Button variant="outline">Edit Profile</Button>
      </DrawerTrigger>
      <DrawerContent>
        <DrawerHandle />
        <DrawerHeader>
          <DrawerTitle>Edit Profile</DrawerTitle>
          <DrawerDescription>
            Make changes to your profile here. Click save when you&apos;re done.
          </DrawerDescription>
        </DrawerHeader>
        <form
          id="drawer-form"
          className="grid gap-4 p-4"
          onSubmit={(e) => e.preventDefault()}
        >
          <div className="grid gap-2">
            <Label htmlFor="drawer-name">Name</Label>
            <Input id="drawer-name" placeholder="Placeholder" />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="drawer-username">Username</Label>
            <Input id="drawer-username" placeholder="Placeholder" />
          </div>
        </form>
        <DrawerFooter>
          <Button type="submit" form="drawer-form">
            Save changes
          </Button>
          <DrawerClose asChild>
            <Button type="button" variant="outline">
              Cancel
            </Button>
          </DrawerClose>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  ),
}

export const Directions: StoryObj = {
  parameters: { controls: { disable: true } },
  render: () => (
    <div className="flex flex-wrap gap-4">
      {directions.map(({ value, label }) => (
        <div key={value} className="flex flex-col gap-2">
          <p className="text-muted-foreground text-xs font-medium uppercase tracking-wide">
            {label}
          </p>
          <Drawer direction={value}>
            <DrawerTrigger asChild>
              <Button variant="outline">Open {label}</Button>
            </DrawerTrigger>
            <DrawerContent>
              {hasHandle(value) && <DrawerHandle />}
              <DrawerHeader>
                <DrawerTitle>{label} Drawer</DrawerTitle>
                <DrawerDescription>
                  direction=&quot;{value}&quot;
                </DrawerDescription>
              </DrawerHeader>
              <DrawerFooter>
                <Button type="button">Confirm</Button>
                <DrawerClose asChild>
                  <Button type="button" variant="outline">
                    Cancel
                  </Button>
                </DrawerClose>
              </DrawerFooter>
            </DrawerContent>
          </Drawer>
        </div>
      ))}
    </div>
  ),
}

export const Overflow: StoryObj = {
  parameters: { controls: { disable: true } },
  render: () => (
    <Drawer>
      <DrawerTrigger asChild>
        <Button variant="outline">Open with Long Content</Button>
      </DrawerTrigger>
      <DrawerContent>
        <DrawerHandle />
        <DrawerHeader>
          <DrawerTitle>Long Content</DrawerTitle>
          <DrawerDescription>
            DrawerBody scrolls independently — header and footer stay fixed.
          </DrawerDescription>
        </DrawerHeader>
        <DrawerBody>
          {Array.from({ length: 20 }, (_, i) => (
            <p
              key={i}
              className="py-2 text-sm border-b border-border last:border-0"
            >
              Item {i + 1} — scrollable content row
            </p>
          ))}
        </DrawerBody>
        <DrawerFooter>
          <Button type="button">Confirm</Button>
          <DrawerClose asChild>
            <Button type="button" variant="outline">
              Cancel
            </Button>
          </DrawerClose>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  ),
}

export const Anatomy: StoryObj = {
  parameters: { controls: { disable: true } },
  render: () => (
    <Drawer>
      <DrawerTrigger asChild>
        <Button variant="outline">Open Anatomy</Button>
      </DrawerTrigger>
      <DrawerContent>
        <div className="border-border border-b border-dashed">
          <p className="text-muted-foreground px-4 pt-2 text-xs font-medium uppercase tracking-wide">
            DrawerHandle
          </p>
          <DrawerHandle />
        </div>
        <div className="border-border border-b border-dashed">
          <p className="text-muted-foreground px-4 pt-2 text-xs font-medium uppercase tracking-wide">
            DrawerHeader
          </p>
          <DrawerHeader>
            <DrawerTitle>DrawerTitle</DrawerTitle>
            <DrawerDescription>DrawerDescription</DrawerDescription>
          </DrawerHeader>
        </div>
        <div className="border-border border-b border-dashed">
          <p className="text-muted-foreground px-4 pt-2 text-xs font-medium uppercase tracking-wide">
            DrawerBody
          </p>
          <DrawerBody className="text-sm">Body content goes here.</DrawerBody>
        </div>
        <div className="border-border border-dashed">
          <p className="text-muted-foreground px-4 pt-2 text-xs font-medium uppercase tracking-wide">
            DrawerFooter
          </p>
          <DrawerFooter>
            <Button type="button">Primary Action</Button>
            <DrawerClose asChild>
              <Button type="button" variant="outline">
                Cancel
              </Button>
            </DrawerClose>
          </DrawerFooter>
        </div>
      </DrawerContent>
    </Drawer>
  ),
}
