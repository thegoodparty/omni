import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { Toaster, toast } from '../components/ui/sonner'
import { Button } from '../components/ui/button'

const meta: Meta<typeof Toaster> = {
  title: 'Components/Toast',
  component: Toaster,
  tags: ['autodocs'],
}

export default meta

type Story = StoryObj<typeof Toaster>

// The app mounts one <Toaster position="bottom-center" /> in
// app/shared/utils/Snackbar.tsx, so every story here matches that
// placement — a Storybook demo that lands somewhere the app never puts
// toasts is a demo of a control the app doesn't have.
export const Default: Story = {
  parameters: { controls: { disable: true } },
  render: () => (
    <div className="flex flex-col items-start gap-3">
      <Button onClick={() => toast('This is a toast notification!')}>
        Show toast
      </Button>
      <Toaster position="bottom-center" />
    </div>
  ),
}

export const Variants: Story = {
  parameters: { controls: { disable: true } },
  render: () => (
    <div className="flex flex-col items-start gap-3">
      <Button onClick={() => toast('Neutral notice')}>Neutral</Button>
      <Button
        onClick={() => toast.success('Saved successfully')}
        variant="secondary"
      >
        Success
      </Button>
      <Button
        onClick={() => toast.error('Something went wrong')}
        variant="destructive"
      >
        Error
      </Button>
      <Toaster position="bottom-center" />
    </div>
  ),
}

const LONG_TITLE =
  'Your text message to 1,284 voters in Ward 3 was scheduled for tomorrow at 10:00 AM'
const LONG_DESCRIPTION =
  'We will send it once your campaign phone number is verified. You can change the time or the message until it goes out.'

export const LongText: Story = {
  parameters: { controls: { disable: true } },
  render: () => (
    <div className="flex flex-col items-start gap-3">
      <Button onClick={() => toast.success(LONG_TITLE)}>Long title</Button>
      <Button
        onClick={() =>
          toast.success(LONG_TITLE, { description: LONG_DESCRIPTION })
        }
        variant="secondary"
      >
        Long title and description
      </Button>
      <Button
        onClick={() =>
          toast.error(LONG_TITLE, {
            description: LONG_DESCRIPTION,
            action: { label: 'View schedule', onClick: () => {} },
          })
        }
        variant="destructive"
      >
        Long text with action
      </Button>
      <Toaster position="bottom-center" />
    </div>
  ),
}

export const LongTextAboveChatBar: Story = {
  parameters: { controls: { disable: true } },
  render: () => (
    <div className="flex flex-col items-start gap-3">
      <Button
        onClick={() =>
          toast.error(LONG_TITLE, {
            description: LONG_DESCRIPTION,
            action: { label: 'View schedule', onClick: () => {} },
          })
        }
      >
        Long text above chat bar
      </Button>
      <Toaster
        position="bottom-center"
        offset={{ bottom: '6rem' }}
        mobileOffset={{ bottom: '6rem' }}
      />
    </div>
  ),
}
