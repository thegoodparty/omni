import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { ScrollArea } from '../components/ui/scroll-area'

const meta: Meta<typeof ScrollArea> = {
  title: 'Components/ScrollArea',
  component: ScrollArea,
  tags: ['autodocs'],
}

export default meta

type Story = StoryObj<typeof ScrollArea>

type PlaygroundArgs = {
  type: 'auto' | 'always' | 'scroll' | 'hover'
  orientation: 'vertical' | 'horizontal' | 'both'
  height: number
  itemCount: number
}

export const Playground: StoryObj<PlaygroundArgs> = {
  args: {
    type: 'hover',
    orientation: 'vertical',
    height: 160,
    itemCount: 20,
  },
  argTypes: {
    type: {
      control: 'select',
      options: ['auto', 'always', 'scroll', 'hover'],
      description:
        'When the scrollbar is visible. auto: when content overflows. always: visible. scroll: while scrolling. hover: while hovering.',
    },
    orientation: {
      control: 'select',
      options: ['vertical', 'horizontal', 'both'],
      description: 'Which scrollbar(s) to render.',
    },
    height: { control: { type: 'number', min: 80, max: 400, step: 8 } },
    itemCount: { control: { type: 'number', min: 1, max: 100, step: 1 } },
  },
  render: ({ type, orientation, height, itemCount }) => {
    const isHorizontal = orientation === 'horizontal'
    const isBoth = orientation === 'both'
    const containerStyle = isHorizontal
      ? { width: 288 }
      : isBoth
        ? { height, width: 288 }
        : { height, width: 192 }
    const innerStyle = isHorizontal || isBoth ? { width: 800 } : undefined
    const innerClass = isHorizontal || isBoth ? 'flex gap-4' : 'space-y-4'
    return (
      <ScrollArea
        type={type}
        orientation={orientation}
        className="rounded-md border p-4"
        style={containerStyle}
      >
        <div className={innerClass} style={innerStyle}>
          {Array.from({ length: itemCount }, (_, i) => (
            <div
              key={i}
              className={
                isHorizontal || isBoth
                  ? 'h-16 w-16 shrink-0 rounded bg-muted p-2 text-xs text-muted-foreground'
                  : 'h-8 rounded bg-muted p-2 text-muted-foreground'
              }
            >
              Item {i + 1}
            </div>
          ))}
        </div>
      </ScrollArea>
    )
  },
}

export const Anatomy: Story = {
  parameters: { controls: { disable: true } },
  render: () => (
    <div className="flex flex-col gap-2">
      <p className="text-muted-foreground text-xs">
        data-slot=&quot;scroll-area&quot; — Root
      </p>
      <div className="relative">
        <ScrollArea
          type="always"
          orientation="vertical"
          className="h-40 w-48 rounded-md border p-4"
        >
          <p className="text-muted-foreground mb-2 text-xs">
            data-slot=&quot;scroll-area-viewport&quot;
          </p>
          <div className="space-y-4">
            {Array.from({ length: 10 }, (_, i) => (
              <div
                key={i}
                className="h-8 rounded bg-muted p-2 text-muted-foreground"
              >
                Item {i + 1}
              </div>
            ))}
          </div>
        </ScrollArea>
        <p className="text-muted-foreground mt-1 text-xs">
          data-slot=&quot;scroll-area-scrollbar&quot; +
          &quot;scroll-area-thumb&quot;
        </p>
      </div>
    </div>
  ),
}

export const ScrollbarTypes: Story = {
  parameters: { controls: { disable: true } },
  render: () => (
    <div className="flex gap-6">
      {(['auto', 'always', 'scroll', 'hover'] as const).map((type) => (
        <div key={type} className="flex flex-col gap-2">
          <span className="text-muted-foreground text-xs">{type}</span>
          <ScrollArea
            type={type}
            orientation="vertical"
            className="h-40 w-36 rounded-md border p-4"
          >
            <div className="space-y-4">
              {Array.from({ length: 20 }, (_, i) => (
                <div
                  key={i}
                  className="h-8 rounded bg-muted p-2 text-muted-foreground"
                >
                  Item {i + 1}
                </div>
              ))}
            </div>
          </ScrollArea>
        </div>
      ))}
    </div>
  ),
}

export const Horizontal: Story = {
  parameters: { controls: { disable: true } },
  render: () => (
    <ScrollArea
      type="always"
      orientation="horizontal"
      className="w-72 rounded-md border p-4"
    >
      <div className="flex gap-4" style={{ width: 800 }}>
        {Array.from({ length: 20 }, (_, i) => (
          <div
            key={i}
            className="h-16 w-16 shrink-0 rounded bg-muted p-2 text-xs text-muted-foreground"
          >
            Item {i + 1}
          </div>
        ))}
      </div>
    </ScrollArea>
  ),
}

export const Both: Story = {
  parameters: { controls: { disable: true } },
  render: () => (
    <ScrollArea
      type="always"
      orientation="both"
      className="h-48 w-72 rounded-md border p-4"
    >
      <div className="space-y-4" style={{ width: 600 }}>
        {Array.from({ length: 20 }, (_, i) => (
          <div
            key={i}
            className="h-8 rounded bg-muted p-2 text-muted-foreground"
          >
            Item {i + 1}
          </div>
        ))}
      </div>
    </ScrollArea>
  ),
}
