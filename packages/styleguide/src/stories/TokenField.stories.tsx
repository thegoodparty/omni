import * as React from 'react'
import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import {
  TokenField,
  type ProtectedSpec,
  type TokenFieldRef,
  type TokenSpec,
} from '../components/ui/token-field'
import { Button } from '../components/ui/button'
import { Card } from '../components/ui/card'

const meta: Meta<typeof TokenField> = {
  title: 'Components/TokenField',
  component: TokenField,
  tags: ['autodocs'],
}

export default meta
type Story = StoryObj<typeof TokenField>

const FIRST_NAME: TokenSpec = {
  id: 'first_name',
  label: 'First name',
  text: '{first_name}',
  required: true,
}

// The SMS spans from the plan (docs/features/message-composer.md): the name,
// "Paid for by" and the committee as two spans so a candidate can write
// between them, and the opt-out line whole.
const SMS_SPANS: ProtectedSpec[] = [
  {
    id: 'candidate_name',
    text: 'Sarah Chen',
    reason: 'Your name has to appear in the message. You can reword the rest.',
  },
  {
    id: 'paid_for_by',
    text: 'Paid for by',
    reason:
      'Campaign finance rules require this line. You can write around it.',
  },
  {
    id: 'committee_name',
    text: 'Friends of Sarah Chen',
    reason:
      'Campaign finance rules require this line. You can write around it.',
  },
  {
    id: 'opt_out',
    text: 'Reply STOP to opt out.',
    reason:
      'Every text has to offer a way to opt out. You can write around this line.',
  },
]

const SMS_MESSAGE = `Hello {first_name}, it's Sarah Chen, running for city council. Can I count on your vote on November 3?
Paid for by Friends of Sarah Chen. Reply STOP to opt out.`

const ROBOCALL_SPANS: ProtectedSpec[] = [
  {
    id: 'candidate_name',
    text: 'Sarah Chen',
    reason:
      'A recorded call has to say who you are and what you are running for.',
  },
  {
    id: 'candidacy',
    text: 'candidate for city council',
    reason:
      'A recorded call has to say who you are and what you are running for.',
  },
  {
    id: 'paid_for_by',
    text: 'Paid for by',
    reason:
      'Campaign finance rules require this line. You can write around it.',
  },
  {
    id: 'sponsor',
    text: 'Friends of Sarah Chen',
    reason:
      'Campaign finance rules require this line. You can write around it.',
  },
  {
    id: 'callback',
    text: '(555) 010-2030',
    reason:
      'A recorded call has to give a callback number. Read it as written.',
  },
]

const ROBOCALL_SCRIPT = `Hi, this is Sarah Chen, candidate for city council. I'm calling to ask for your vote on November 3.
Paid for by Friends of Sarah Chen. Call us back at (555) 010-2030.`

// The composer's own arrangement: the field seamless inside a card, and the
// blocked edit's reason in a status region under it. The shake and tint are
// the field's; the words are the caller's, because a screen reader gets
// neither a shake nor a colour.
const Composer = ({
  initial,
  tokens,
  spans,
  label,
  showInsert,
}: {
  initial: string
  tokens: TokenSpec[]
  spans: ProtectedSpec[]
  label: string
  showInsert?: boolean
}) => {
  const [value, setValue] = React.useState(initial)
  const [reason, setReason] = React.useState('')
  const ref = React.useRef<TokenFieldRef>(null)
  const statusId = React.useId()
  return (
    <div className="flex w-full max-w-md flex-col gap-2">
      <Card className="gap-0 p-4">
        <TokenField
          ref={ref}
          variant="seamless"
          className="min-h-[140px]"
          aria-label={label}
          aria-describedby={statusId}
          value={value}
          onChange={(next) => {
            setValue(next)
            setReason('')
          }}
          tokens={tokens}
          protectedRanges={spans}
          onBlockedEdit={(target) =>
            setReason(
              'reason' in target
                ? target.reason
                : `The ${target.label.toLowerCase()} tag is required. You can move it, not remove it.`,
            )
          }
        />
        {showInsert && (
          <div className="border-border -mx-4 -mb-4 mt-4 flex justify-end border-t p-2">
            <Button
              size="small"
              variant="ghost"
              onClick={() => ref.current?.insertToken('first_name')}
            >
              Insert first name
            </Button>
          </div>
        )}
      </Card>
      <p
        id={statusId}
        role="status"
        className="min-h-5 text-sm text-destructive"
      >
        {reason}
      </p>
      <pre className="whitespace-pre-wrap rounded-md bg-muted p-3 text-xs text-muted-foreground">
        {value}
      </pre>
    </div>
  )
}

export const Playground: Story = {
  args: {
    variant: 'default',
    readOnly: false,
    placeholder: 'Write your message…',
  },
  argTypes: {
    variant: {
      control: 'inline-radio',
      options: ['default', 'seamless'],
      description: 'As on Textarea: seamless for a field inside a card.',
    },
    readOnly: { control: 'boolean' },
    placeholder: { control: 'text' },
    value: { table: { disable: true } },
    onChange: { table: { disable: true } },
    tokens: { table: { disable: true } },
    protectedRanges: { table: { disable: true } },
    onBlockedEdit: { table: { disable: true } },
  },
  render: ({ variant, readOnly, placeholder }) => {
    const [value, setValue] = React.useState('')
    return (
      <div className="w-full max-w-md">
        <TokenField
          aria-label="Message"
          variant={variant}
          readOnly={readOnly}
          placeholder={placeholder}
          value={value}
          onChange={setValue}
          tokens={[FIRST_NAME]}
        />
      </div>
    )
  },
}

// Try to delete "Reply STOP to opt out." or the first name pill: the part
// shakes, turns red and the reason appears below. Select everything and
// type: your text replaces the rest and the locked parts stay.
export const SmsMessage: Story = {
  parameters: { controls: { disable: true } },
  render: () => (
    <Composer
      label="Message body"
      initial={SMS_MESSAGE}
      tokens={[FIRST_NAME]}
      spans={SMS_SPANS}
      showInsert
    />
  ),
}

// No tokens at all: a recording is one audio file played to everyone, so
// there is nothing to merge. Everything the recording checks listen for is a
// span, broken up so a candidate can add their state's own wording inside
// the disclosure.
export const RobocallScript: Story = {
  parameters: { controls: { disable: true } },
  render: () => (
    <Composer
      label="Robocall script"
      initial={ROBOCALL_SCRIPT}
      tokens={[]}
      spans={ROBOCALL_SPANS}
    />
  ),
}

export const ReadOnly: Story = {
  parameters: { controls: { disable: true } },
  render: () => (
    <div className="w-full max-w-md">
      <TokenField
        aria-label="Message body"
        readOnly
        value={SMS_MESSAGE}
        onChange={() => undefined}
        tokens={[FIRST_NAME]}
        protectedRanges={SMS_SPANS}
      />
    </div>
  ),
}
