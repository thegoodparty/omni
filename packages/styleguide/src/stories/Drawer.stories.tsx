import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { useState } from 'react'
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

// Default (unspecified `maxWidth`) puts a 608px shared column in header,
// body, and footer — the app's canonical bottom-sheet width. Pass a
// Tailwind scale token (`'xs'` through `'5xl'`) to override, or `fullWidth`
// to let content span the whole panel.
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
        <DrawerBody>
          <form
            id="drawer-form"
            className="grid gap-4 py-4"
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
        </DrawerBody>
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

// Every `maxWidth` value on DrawerContent side by side. The 608px `'app'`
// default is the width bottom-sheet flows use; the Tailwind scale is there
// for overrides. `fullWidth` opts out entirely.
export const MaxWidths: StoryObj = {
  parameters: { controls: { disable: true } },
  render: () => {
    const options: Array<{
      label: string
      maxWidth?:
        | 'app'
        | 'xs'
        | 'sm'
        | 'md'
        | 'lg'
        | 'xl'
        | '2xl'
        | '3xl'
        | '4xl'
        | '5xl'
      fullWidth?: boolean
    }> = [
      { label: 'default (app, 608px)' },
      { label: 'lg (512px)', maxWidth: 'lg' },
      { label: 'xl (576px)', maxWidth: 'xl' },
      { label: '2xl (672px)', maxWidth: '2xl' },
      { label: '3xl (768px)', maxWidth: '3xl' },
      { label: 'fullWidth', fullWidth: true },
    ]
    return (
      <div className="flex flex-wrap gap-3">
        {options.map(({ label, maxWidth, fullWidth }) => (
          <Drawer key={label}>
            <DrawerTrigger asChild>
              <Button variant="outline">{label}</Button>
            </DrawerTrigger>
            <DrawerContent maxWidth={maxWidth} fullWidth={fullWidth}>
              <DrawerHandle />
              <DrawerHeader>
                <DrawerTitle>{label}</DrawerTitle>
                <DrawerDescription>
                  Header, body, and footer all sit inside the same shared
                  column.
                </DrawerDescription>
              </DrawerHeader>
              <DrawerBody>
                <p className="py-4 text-sm">
                  This paragraph is capped at the column width. The panel spans
                  the viewport underneath — only the content sits inside the
                  constrained column.
                </p>
              </DrawerBody>
              <DrawerFooter>
                <Button type="button">Continue</Button>
                <DrawerClose asChild>
                  <Button type="button" variant="outline">
                    Cancel
                  </Button>
                </DrawerClose>
              </DrawerFooter>
            </DrawerContent>
          </Drawer>
        ))}
      </div>
    )
  },
}

// Drag options come from vaul directly, passed on `Drawer` (the Root).
//   - `dismissible={false}` — drag is off entirely; only Escape or the
//     built-in close X dismisses.
//   - `handleOnly` — drag only registers on the visible pull bar. Useful
//     when the drawer body itself scrolls or is heavily interactive.
//   - `snapPoints` — the panel takes fixed heights and drags between them.
//     `≤ 1` values are viewport fractions; `> 1` are pixels. Requires
//     dismissible (any truthy value) — you cannot snap-drag a locked drawer.
export const DragBehavior: StoryObj = {
  parameters: { controls: { disable: true } },
  render: () => (
    <div className="flex flex-wrap gap-3">
      <Drawer>
        <DrawerTrigger asChild>
          <Button variant="outline">Drag anywhere (default)</Button>
        </DrawerTrigger>
        <DrawerContent>
          <DrawerHandle />
          <DrawerHeader>
            <DrawerTitle>Drag anywhere</DrawerTitle>
            <DrawerDescription>
              Grab any point on the panel and drag down to dismiss.
            </DrawerDescription>
          </DrawerHeader>
          <DrawerFooter>
            <DrawerClose asChild>
              <Button type="button">Close</Button>
            </DrawerClose>
          </DrawerFooter>
        </DrawerContent>
      </Drawer>

      <Drawer dismissible={false}>
        <DrawerTrigger asChild>
          <Button variant="outline">Drag disabled</Button>
        </DrawerTrigger>
        <DrawerContent>
          <DrawerHeader>
            <DrawerTitle>Non-dismissible</DrawerTitle>
            <DrawerDescription>
              No drag. Close via Escape or the button below.
            </DrawerDescription>
          </DrawerHeader>
          <DrawerFooter>
            <DrawerClose asChild>
              <Button type="button">Close</Button>
            </DrawerClose>
          </DrawerFooter>
        </DrawerContent>
      </Drawer>

      <Drawer handleOnly>
        <DrawerTrigger asChild>
          <Button variant="outline">Handle only</Button>
        </DrawerTrigger>
        <DrawerContent>
          <DrawerHandle />
          <DrawerHeader>
            <DrawerTitle>Handle-only drag</DrawerTitle>
            <DrawerDescription>
              Body ignores drag. Only the pull bar above dismisses.
            </DrawerDescription>
          </DrawerHeader>
          <DrawerBody>
            <p className="py-4 text-sm">
              Try to drag this paragraph — nothing happens. The pull bar is the
              only drag target.
            </p>
          </DrawerBody>
          <DrawerFooter>
            <DrawerClose asChild>
              <Button type="button">Close</Button>
            </DrawerClose>
          </DrawerFooter>
        </DrawerContent>
      </Drawer>
    </div>
  ),
}

// Snap points turn the panel into a multi-position sheet — a peek at the
// smallest, halfway open, and nearly full. Drag between them; releasing at
// the smallest snap dismisses. Requires a controlled `activeSnapPoint` +
// `setActiveSnapPoint` pair, which vaul threads through automatically.
export const SnapPoints: StoryObj = {
  parameters: { controls: { disable: true } },
  render: () => {
    const snapPoints: (string | number)[] = [0.2, 0.5, 0.95]
    const Story = () => {
      const [open, setOpen] = useState(false)
      const [snap, setSnap] = useState<string | number | null>(snapPoints[0]!)
      return (
        <>
          <Button variant="outline" onClick={() => setOpen(true)}>
            Open snap drawer
          </Button>
          <Drawer
            open={open}
            onOpenChange={setOpen}
            snapPoints={snapPoints}
            activeSnapPoint={snap}
            setActiveSnapPoint={setSnap}
          >
            <DrawerContent>
              <DrawerHandle />
              <DrawerHeader>
                <DrawerTitle>Snap sheet</DrawerTitle>
                <DrawerDescription>
                  Drag the panel between three heights: peek, half, and nearly
                  full. Current snap:{' '}
                  <span className="font-mono">{String(snap)}</span>
                </DrawerDescription>
              </DrawerHeader>
              <DrawerBody>
                {Array.from({ length: 25 }, (_, i) => (
                  <p
                    key={i}
                    className="py-2 text-sm border-b border-border last:border-0"
                  >
                    Row {i + 1}
                  </p>
                ))}
              </DrawerBody>
            </DrawerContent>
          </Drawer>
        </>
      )
    }
    return <Story />
  },
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
