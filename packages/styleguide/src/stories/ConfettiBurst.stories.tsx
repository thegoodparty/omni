import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { useEffect, useState } from 'react'
import { ConfettiBurst } from '../components/ui/confetti-burst'
import { Button } from '../components/ui/button'
import { ProBadge } from '../components/ui/pro-badge'
import {
  CheckIcon,
  ClipboardListIcon,
  DoorOpenIcon,
  HeadsetIcon,
  MessageSquareIcon,
  PhoneIcon,
  Share2Icon,
} from '../components/ui/icons'

const meta: Meta<typeof ConfettiBurst> = {
  component: ConfettiBurst,
  title: 'Components/ConfettiBurst',
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component:
          'A one-shot celebration burst for the moment something becomes true — a step completes, an outreach launches, an upgrade lands. Whatever you pass as children sits at the center and the burst overflows around it, so it is not tied to a checkmark. There is deliberately no size prop: every burst is identical, because a celebration that is bigger on one surface than another reads as inconsistent rather than responsive. The center gets the animate-pop-in entrance automatically on every fire; callers do not add the class themselves. Ported from the designer Lottie as CSS keyframes rather than shipping a Lottie runtime, which is what lets the particles read design tokens and follow dark mode. Under prefers-reduced-motion the burst and the pop are both suppressed and the center content simply renders.',
      },
    },
  },
  tags: ['autodocs'],
}
export default meta

type Story = StoryObj<typeof ConfettiBurst>

// The component is a one-shot, so every story needs a way to re-fire. It also
// fires itself on mount: a motion story that renders nothing until you find a
// button is indistinguishable from a broken one.
const Replay = ({
  label = 'Replay',
  children,
}: {
  label?: string
  children?: React.ReactNode
}) => {
  const [play, setPlay] = useState(false)

  useEffect(() => {
    // A beat after mount rather than immediately, so the burst is not already
    // half over by the time the story canvas finishes painting.
    const start = setTimeout(() => setPlay(true), 250)
    return () => clearTimeout(start)
  }, [])

  useEffect(() => {
    if (!play) return
    const timer = setTimeout(() => setPlay(false), 1000)
    return () => clearTimeout(timer)
  }, [play])

  // Drop to false first: the component watches for a false→true transition, so
  // pressing the button mid-burst would otherwise be a no-op.
  const fire = () => {
    setPlay(false)
    setTimeout(() => setPlay(true), 0)
  }

  return (
    <div className="flex flex-col items-center gap-6">
      <ConfettiBurst play={play}>{children}</ConfettiBurst>
      <Button variant="secondary" onClick={fire}>
        {label}
      </Button>
    </div>
  )
}

// The surfaces this actually fires on: a completed step, a Pro upgrade, and the
// launch of each outreach channel.
const CENTERS = {
  check: { label: 'Check', node: <CheckIcon className="h-5 w-5 text-primary" /> }, // prettier-ignore
  pro: { label: 'Pro badge', node: <ProBadge /> },
  texting: { label: 'Texting', node: <MessageSquareIcon className="h-5 w-5 text-primary" /> }, // prettier-ignore
  robocall: { label: 'Robocall', node: <PhoneIcon className="h-5 w-5 text-primary" /> }, // prettier-ignore
  phoneBanking: { label: 'Phone banking', node: <HeadsetIcon className="h-5 w-5 text-primary" /> }, // prettier-ignore
  doorKnocking: { label: 'Door knocking', node: <DoorOpenIcon className="h-5 w-5 text-primary" /> }, // prettier-ignore
  socialMedia: { label: 'Social', node: <Share2Icon className="h-5 w-5 text-primary" /> }, // prettier-ignore
  polls: { label: 'Polls', node: <ClipboardListIcon className="h-5 w-5 text-primary" /> }, // prettier-ignore
  none: { label: 'Bare', node: null },
} as const

type CenterKey = keyof typeof CENTERS

type PlaygroundArgs = {
  center: CenterKey
}

export const Playground: StoryObj<PlaygroundArgs> = {
  args: {
    center: 'check',
  },
  argTypes: {
    center: {
      control: 'select',
      options: Object.keys(CENTERS) as CenterKey[],
      description:
        'What sits at the center. "none" fires a bare burst with nothing inside it.',
    },
  },
  render: ({ center }) => <Replay key={center}>{CENTERS[center].node}</Replay>,
}

export const Centers: Story = {
  parameters: { controls: { disable: true } },
  render: () => (
    <div className="flex items-start gap-14">
      {(['check', 'pro', 'none'] as CenterKey[]).map((key) => (
        <Replay key={key} label={CENTERS[key].label}>
          {CENTERS[key].node}
        </Replay>
      ))}
    </div>
  ),
}

// One per outreach channel — the launch-confirmation surface each of these
// fires on.
export const OutreachChannels: Story = {
  parameters: { controls: { disable: true } },
  render: () => (
    <div className="grid grid-cols-3 gap-x-14 gap-y-10">
      {(
        [
          'texting',
          'robocall',
          'phoneBanking',
          'doorKnocking',
          'socialMedia',
          'polls',
        ] as CenterKey[]
      ).map((key) => (
        <Replay key={key} label={CENTERS[key].label}>
          {CENTERS[key].node}
        </Replay>
      ))}
    </div>
  ),
}

// The shape this is actually for: a row that flips to done mid-flow.
export const InContext: Story = {
  parameters: { controls: { disable: true } },
  render: () => {
    const StepRow = () => {
      const [done, setDone] = useState(false)

      // Same reasoning as Replay: flip to done on its own so the story shows
      // the moment it exists to demonstrate, instead of an inert empty circle.
      useEffect(() => {
        const timer = setTimeout(() => setDone(true), 600)
        return () => clearTimeout(timer)
      }, [])

      return (
        <div className="flex w-80 flex-col gap-4">
          <div className="flex items-center gap-3 rounded-lg border border-border bg-card px-4 py-3">
            <ConfettiBurst play={done}>
              {done ? (
                <CheckIcon className="h-5 w-5 text-primary" />
              ) : (
                <span className="block h-5 w-5 rounded-full border-2 border-border" />
              )}
            </ConfettiBurst>
            <span className="text-sm font-medium text-foreground">
              Finish your campaign plan
            </span>
          </div>
          <Button variant="secondary" onClick={() => setDone((v) => !v)}>
            {done ? 'Reset' : 'Mark complete'}
          </Button>
        </div>
      )
    }

    return <StepRow />
  },
}
