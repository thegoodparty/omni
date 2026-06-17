import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { AspectRatio } from '../components/ui/aspect-ratio'

const meta: Meta<typeof AspectRatio> = {
  title: 'Components/Aspect Ratio',
  component: AspectRatio,
  tags: ['autodocs'],
}

export default meta
type Story = StoryObj<typeof AspectRatio>

const Gradient = ({ className }: { className?: string }) => (
  <div
    className={`h-full w-full ${className}`}
    style={{
      background:
        'linear-gradient(135deg, #e0e6ec 0%, #f7fafb 25%, #d1d8df 50%, #eef3f6 75%, #c8d0d8 100%)',
    }}
  />
)

export const Playground: Story = {
  args: {
    ratio: 16 / 9,
  },
  argTypes: {
    ratio: {
      name: 'Ratio',
      control: { type: 'number', min: 0.25, max: 4, step: 0.05 },
      description: 'Width-to-height ratio. 16/9 ≈ 1.78, 4/3 ≈ 1.33, 1/1 = 1.',
    },
  },
  render: (args) => (
    <div className="w-96">
      <AspectRatio {...args} className="overflow-hidden rounded-md">
        <Gradient />
      </AspectRatio>
    </div>
  ),
}

export const ObjectCover: Story = {
  parameters: { controls: { disable: true } },
  render: () => (
    <div className="w-96">
      <AspectRatio ratio={16 / 9} className="overflow-hidden rounded-md">
        <img
          src="/images/candidate/city.jpg"
          alt="City"
          className="h-full w-full object-cover"
        />
      </AspectRatio>
    </div>
  ),
}

export const ObjectContain: Story = {
  parameters: { controls: { disable: true } },
  render: () => (
    <div className="w-96">
      <AspectRatio
        ratio={16 / 9}
        className="overflow-hidden rounded-md bg-muted"
      >
        <img
          src="/images/candidate/city.jpg"
          alt="City"
          className="h-full w-full object-contain"
        />
      </AspectRatio>
    </div>
  ),
}

export const Ratios: Story = {
  parameters: { controls: { disable: true } },
  render: () => (
    <div className="flex flex-wrap gap-4">
      {(
        [
          { ratio: 16 / 9, label: '16 : 9' },
          { ratio: 4 / 3, label: '4 : 3' },
          { ratio: 1, label: '1 : 1' },
          { ratio: 3 / 4, label: '3 : 4' },
        ] as const
      ).map(({ ratio, label }) => (
        <div key={label} className="w-40">
          <AspectRatio ratio={ratio} className="overflow-hidden rounded-md">
            <Gradient />
          </AspectRatio>
          <p className="text-muted-foreground mt-1 text-center text-xs">
            {label}
          </p>
        </div>
      ))}
    </div>
  ),
}
