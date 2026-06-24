import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { Skeleton } from '../components/ui/skeleton'

const meta: Meta<typeof Skeleton> = {
  title: 'Components/Skeleton',
  component: Skeleton,
  tags: ['autodocs'],
}

export default meta

type Shape =
  | 'line'
  | 'paragraph'
  | 'avatar-with-text'
  | 'card'
  | 'table-row'
  | 'chart'
  | 'donut-chart'
  | 'form'
  | 'detail-panel'
  | 'stat-card'
  | 'inline'

type PlaygroundArgs = {
  shape: Shape
  width: number
  height: number
}

export const Playground: StoryObj<PlaygroundArgs> = {
  args: {
    shape: 'line',
    width: 200,
    height: 16,
  },
  argTypes: {
    shape: {
      name: 'Shape',
      control: 'select',
      options: [
        'line',
        'paragraph',
        'avatar-with-text',
        'card',
        'table-row',
        'chart',
        'donut-chart',
        'form',
        'detail-panel',
        'stat-card',
        'inline',
      ],
      description: 'Preset shape. Width/height only apply to "line".',
    },
    width: {
      name: 'Width (px)',
      control: { type: 'number', min: 16, max: 600, step: 1 },
      if: { arg: 'shape', eq: 'line' },
    },
    height: {
      name: 'Height (px)',
      control: { type: 'number', min: 4, max: 200, step: 1 },
      if: { arg: 'shape', eq: 'line' },
    },
  },
  render: ({ shape, width, height }) => {
    if (shape === 'paragraph')
      return (
        <div className="space-y-2 w-[300px]">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-5/6" />
          <Skeleton className="h-4 w-3/4" />
        </div>
      )

    if (shape === 'avatar-with-text')
      return (
        <div className="flex items-center gap-3 w-[300px]">
          <Skeleton className="h-10 w-10 rounded-full shrink-0" />
          <div className="space-y-2 flex-1">
            <Skeleton className="h-4 w-1/2" />
            <Skeleton className="h-3 w-1/3" />
          </div>
        </div>
      )

    if (shape === 'card')
      return (
        <div className="space-y-3 w-[300px]">
          <Skeleton className="h-32 w-full rounded-lg" />
          <Skeleton className="h-5 w-2/3" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-5/6" />
        </div>
      )

    if (shape === 'table-row')
      return (
        <div className="w-[500px] space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="flex gap-4">
              <Skeleton className="h-4 w-1/4" />
              <Skeleton className="h-4 w-1/4" />
              <Skeleton className="h-4 w-1/4" />
              <Skeleton className="h-4 w-1/4" />
            </div>
          ))}
        </div>
      )

    if (shape === 'chart')
      return (
        <div className="w-[300px] h-40 flex items-end gap-2 px-2">
          {[30, 55, 80, 45, 65, 35].map((h, i) => (
            <Skeleton
              key={i}
              className="flex-1 rounded-sm"
              style={{ height: `${h}%` }}
            />
          ))}
        </div>
      )

    if (shape === 'form')
      return (
        <div className="space-y-4 w-[300px]">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="space-y-1.5">
              <Skeleton className="h-3.5 w-24" />
              <Skeleton className="h-10 w-full rounded-md" />
            </div>
          ))}
        </div>
      )

    if (shape === 'donut-chart')
      return (
        <div className="w-[240px] space-y-3">
          <div
            className="flex items-center justify-center"
            style={{ height: 220 }}
          >
            <div
              className="relative flex items-center justify-center"
              style={{ width: 200, height: 200 }}
            >
              <Skeleton
                className="rounded-full"
                style={{ width: 200, height: 200 }}
              />
              <div
                className="absolute rounded-full bg-background"
                style={{ width: 120, height: 120 }}
              />
            </div>
          </div>
          <div className="space-y-2 px-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Skeleton
                    className="rounded-full shrink-0"
                    style={{ width: 8, height: 8 }}
                  />
                  <Skeleton className="h-3 w-20" />
                </div>
                <Skeleton className="h-3 w-8" />
              </div>
            ))}
          </div>
        </div>
      )

    if (shape === 'detail-panel')
      return (
        <div className="space-y-4 w-[300px]">
          <Skeleton className="h-8 w-2/3" />
          <Skeleton className="h-4 w-1/3" />
          <div className="space-y-3 pt-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="space-y-1">
                <Skeleton className="h-3 w-1/4" />
                <Skeleton className="h-5 w-1/2" />
              </div>
            ))}
          </div>
        </div>
      )

    if (shape === 'stat-card')
      return (
        <div className="space-y-2 w-[160px]">
          <Skeleton className="h-9 w-3/4" />
          <Skeleton className="h-3.5 w-1/2" />
        </div>
      )

    if (shape === 'inline')
      return (
        <div className="w-[300px] p-4 border rounded-lg space-y-3">
          <p className="text-sm text-muted-foreground">Card title</p>
          <Skeleton className="h-8 w-32" />
          <div className="space-y-1.5">
            <Skeleton className="h-3 w-5/6" />
            <Skeleton className="h-3 w-4/6" />
          </div>
        </div>
      )

    return <Skeleton style={{ width, height }} />
  },
}

const labelClass = 'text-xs text-muted-foreground font-medium mb-2'

export const Compositions: StoryObj = {
  parameters: { controls: { disable: true } },
  render: () => (
    <div className="flex flex-col gap-10 w-[500px]">
      <div>
        <p className={labelClass}>Paragraph</p>
        <div className="space-y-2">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-5/6" />
          <Skeleton className="h-4 w-3/4" />
        </div>
      </div>

      <div>
        <p className={labelClass}>Avatar + text</p>
        <div className="flex items-center gap-3">
          <Skeleton className="h-10 w-10 rounded-full shrink-0" />
          <div className="space-y-2 flex-1">
            <Skeleton className="h-4 w-1/2" />
            <Skeleton className="h-3 w-1/3" />
          </div>
        </div>
      </div>

      <div>
        <p className={labelClass}>Card</p>
        <div className="space-y-3">
          <Skeleton className="h-32 w-full rounded-lg" />
          <Skeleton className="h-5 w-2/3" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-5/6" />
        </div>
      </div>

      <div>
        <p className={labelClass}>Table rows</p>
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="flex gap-4">
              <Skeleton className="h-4 w-1/4" />
              <Skeleton className="h-4 w-1/4" />
              <Skeleton className="h-4 w-1/4" />
              <Skeleton className="h-4 w-1/4" />
            </div>
          ))}
        </div>
      </div>

      <div>
        <p className={labelClass}>Chart</p>
        <div className="h-40 flex items-end gap-2 px-2">
          {[30, 55, 80, 45, 65, 35].map((h, i) => (
            <Skeleton
              key={i}
              className="flex-1 rounded-sm"
              style={{ height: `${h}%` }}
            />
          ))}
        </div>
      </div>

      <div>
        <p className={labelClass}>Form</p>
        <div className="space-y-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="space-y-1.5">
              <Skeleton className="h-3.5 w-24" />
              <Skeleton className="h-10 w-full rounded-md" />
            </div>
          ))}
        </div>
      </div>

      <div>
        <p className={labelClass}>Donut chart</p>
        <div className="w-[240px] space-y-3">
          <div
            className="flex items-center justify-center"
            style={{ height: 220 }}
          >
            <div
              className="relative flex items-center justify-center"
              style={{ width: 200, height: 200 }}
            >
              <Skeleton
                className="rounded-full"
                style={{ width: 200, height: 200 }}
              />
              <div
                className="absolute rounded-full bg-background"
                style={{ width: 120, height: 120 }}
              />
            </div>
          </div>
          <div className="space-y-2 px-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Skeleton
                    className="rounded-full shrink-0"
                    style={{ width: 8, height: 8 }}
                  />
                  <Skeleton className="h-3 w-20" />
                </div>
                <Skeleton className="h-3 w-8" />
              </div>
            ))}
          </div>
        </div>
      </div>

      <div>
        <p className={labelClass}>Detail panel</p>
        <div className="space-y-4">
          <Skeleton className="h-8 w-2/3" />
          <Skeleton className="h-4 w-1/3" />
          <div className="space-y-3 pt-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="space-y-1">
                <Skeleton className="h-3 w-1/4" />
                <Skeleton className="h-5 w-1/2" />
              </div>
            ))}
          </div>
        </div>
      </div>

      <div>
        <p className={labelClass}>Stat card</p>
        <div className="space-y-2 w-[160px]">
          <Skeleton className="h-9 w-3/4" />
          <Skeleton className="h-3.5 w-1/2" />
        </div>
      </div>

      <div>
        <p className={labelClass}>Inline (value inside card)</p>
        <div className="p-4 border rounded-lg space-y-3">
          <p className="text-sm text-muted-foreground">Card title</p>
          <Skeleton className="h-8 w-32" />
          <div className="space-y-1.5">
            <Skeleton className="h-3 w-5/6" />
            <Skeleton className="h-3 w-4/6" />
          </div>
        </div>
      </div>
    </div>
  ),
}
