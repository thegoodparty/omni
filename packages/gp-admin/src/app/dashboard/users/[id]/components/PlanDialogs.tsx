'use client'

import { useState, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import {
  Button,
  Callout,
  Dialog,
  Flex,
  Select,
  Text,
  TextArea,
  TextField,
} from '@radix-ui/themes'
import { PLAN_PRICING } from '@goodparty_org/contracts'
import type { CampaignPlanName } from '@/shared/gpApi'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { useToast } from '@/components/Toast'
import { describeActionFailure } from '@/shared/util/actionFailure.util'
import {
  extendCampaignPlan,
  refundCampaignPlan,
  setCampaignPlan,
  type PlanActionResult,
} from '@/app/dashboard/campaigns/planActions'

export const PLAN_LABELS: Record<CampaignPlanName, string> = {
  free: 'Free',
  pro: 'Pro',
  team: 'Team',
}

interface PlanDialogProps {
  campaignId: number
  userId: number
}

const MS_PER_DAY = 24 * 60 * 60 * 1000

export const daysSince = (value: Date | string | null | undefined) =>
  value
    ? Math.floor((Date.now() - new Date(value).getTime()) / MS_PER_DAY)
    : null

const formatCents = (cents: number) => `$${(cents / 100).toFixed(2)}`

// Shared shell: trigger button, dialog, inline error, cancel/confirm row.
function PlanDialog<T>({
  trigger,
  title,
  description,
  confirmLabel,
  confirmColor,
  canSubmit,
  run,
  onDone,
  onReset,
  children,
}: {
  trigger: string
  title: string
  description: string
  confirmLabel: string
  confirmColor?: 'red'
  canSubmit: boolean
  run: () => Promise<PlanActionResult<T>>
  onDone: (data: T) => string
  onReset: () => void
  children: ReactNode
}) {
  const router = useRouter()
  const { showToast } = useToast()
  const [open, setOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isBusy, setIsBusy] = useState(false)

  const handleOpenChange = (next: boolean) => {
    if (isBusy) return
    setError(null)
    onReset()
    setOpen(next)
  }

  const handleSubmit = async () => {
    setIsBusy(true)
    setError(null)
    try {
      const result = await run()
      if (result.error !== null) {
        setError(result.error)
        return
      }
      showToast(onDone(result.data))
      setOpen(false)
      router.refresh()
    } catch (failure) {
      setError(describeActionFailure(failure, "Couldn't save the change"))
    } finally {
      setIsBusy(false)
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={handleOpenChange}>
      <Dialog.Trigger>
        <Button size="1" variant="outline">
          {trigger}
        </Button>
      </Dialog.Trigger>
      <Dialog.Content maxWidth="480px">
        <Dialog.Title>{title}</Dialog.Title>
        <Dialog.Description size="2" mb="4">
          {description}
        </Dialog.Description>
        <Flex direction="column" gap="3">
          {children}
        </Flex>
        {error && (
          <Callout.Root color="red" mt="3">
            <Callout.Text>{error}</Callout.Text>
          </Callout.Root>
        )}
        <Flex gap="3" mt="4" justify="end">
          <Dialog.Close>
            <Button variant="soft" color="gray" disabled={isBusy}>
              Cancel
            </Button>
          </Dialog.Close>
          <Button
            color={confirmColor}
            onClick={handleSubmit}
            disabled={!canSubmit || isBusy}
            loading={isBusy}
          >
            {confirmLabel}
          </Button>
        </Flex>
      </Dialog.Content>
    </Dialog.Root>
  )
}

const ReasonField = ({
  value,
  onChange,
}: {
  value: string
  onChange: (value: string) => void
}) => (
  <label>
    <Text as="div" size="2" weight="medium" mb="1">
      Reason
    </Text>
    <TextArea
      value={value}
      placeholder="Why are you making this change?"
      onChange={(e) => onChange(e.target.value)}
    />
  </label>
)

export function SetPlanDialog({
  campaignId,
  userId,
  currentPlan,
}: PlanDialogProps & { currentPlan: CampaignPlanName }) {
  const [plan, setPlan] = useState<CampaignPlanName>(currentPlan)
  const [credit, setCredit] = useState('')
  const [reason, setReason] = useState('')

  const creditDollars = credit.trim() === '' ? undefined : Number(credit)
  const creditInvalid =
    creditDollars !== undefined &&
    (!Number.isFinite(creditDollars) || creditDollars < 0)

  return (
    <PlanDialog
      trigger="Change plan"
      title="Which plan should they have?"
      description="This is a comp. It doesn't charge them or send a receipt."
      confirmLabel="Change plan"
      canSubmit={reason.trim() !== '' && !creditInvalid}
      run={() =>
        setCampaignPlan(campaignId, userId, {
          plan,
          reason: reason.trim(),
          ...(creditDollars !== undefined && {
            creditCents: Math.round(creditDollars * 100),
          }),
        })
      }
      onDone={(state) => `Plan set to ${PLAN_LABELS[state.plan]}`}
      onReset={() => {
        setPlan(currentPlan)
        setCredit('')
        setReason('')
      }}
    >
      <label>
        <Text as="div" size="2" weight="medium" mb="1">
          Plan
        </Text>
        <Select.Root
          value={plan}
          onValueChange={(value) => setPlan(value as CampaignPlanName)}
        >
          <Select.Trigger aria-label="Plan" />
          <Select.Content>
            {Object.entries(PLAN_LABELS).map(([value, label]) => (
              <Select.Item key={value} value={value}>
                {label}
              </Select.Item>
            ))}
          </Select.Content>
        </Select.Root>
      </label>
      <label>
        <Text as="div" size="2" weight="medium" mb="1">
          Outreach credit in dollars (optional)
        </Text>
        <TextField.Root
          inputMode="decimal"
          value={credit}
          placeholder="Leave blank to keep their balance"
          onChange={(e) => setCredit(e.target.value)}
        />
        {creditInvalid && (
          <Text size="1" color="red">
            Enter an amount of 0 or more.
          </Text>
        )}
      </label>
      <ReasonField value={reason} onChange={setReason} />
    </PlanDialog>
  )
}

export function ExtendPlanDialog({ campaignId, userId }: PlanDialogProps) {
  const [date, setDate] = useState('')
  const [reason, setReason] = useState('')
  const [clear, setClear] = useState(false)

  return (
    <PlanDialog
      trigger="Set end date"
      title="When should their plan end?"
      description="This replaces the date from their election. Clear it to go back to the election date."
      confirmLabel={clear ? 'Clear end date' : 'Set end date'}
      canSubmit={reason.trim() !== '' && (clear || date !== '')}
      run={() =>
        extendCampaignPlan(campaignId, userId, {
          endsAt: clear ? null : `${date}T23:59:59.000Z`,
          reason: reason.trim(),
        })
      }
      onDone={() => (clear ? 'End date cleared' : 'End date set')}
      onReset={() => {
        setDate('')
        setReason('')
        setClear(false)
      }}
    >
      <label>
        <Text as="div" size="2" weight="medium" mb="1">
          Good through
        </Text>
        <TextField.Root
          type="date"
          value={date}
          disabled={clear}
          onChange={(e) => setDate(e.target.value)}
        />
      </label>
      <Text as="label" size="2">
        <Flex gap="2" align="center">
          <input
            type="checkbox"
            checked={clear}
            onChange={(e) => setClear(e.target.checked)}
          />
          Clear the override
        </Flex>
      </Text>
      <ReasonField value={reason} onChange={setReason} />
    </PlanDialog>
  )
}

export function RefundPlanDialog({
  campaignId,
  userId,
  planPaidAt,
}: PlanDialogProps & { planPaidAt: Date | string | null | undefined }) {
  const router = useRouter()
  const { showToast } = useToast()
  const [open, setOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isBusy, setIsBusy] = useState(false)
  const days = daysSince(planPaidAt)
  const outsideWindow = days !== null && days > PLAN_PRICING.refundWindowDays

  const handleConfirm = async () => {
    setIsBusy(true)
    setError(null)
    try {
      const result = await refundCampaignPlan(campaignId, userId)
      if (result.error !== null) {
        setError(result.error)
        return
      }
      const { refundedCents, eligibility } = result.data
      showToast(
        `Refunded ${formatCents(refundedCents)}. ${eligibility.daysSincePurchase} days since purchase, ${
          eligibility.outreachSent ? 'outreach was sent' : 'no outreach sent'
        }.`
      )
      setOpen(false)
      router.refresh()
    } catch (failure) {
      setError(describeActionFailure(failure, "Couldn't refund the plan"))
    } finally {
      setIsBusy(false)
    }
  }

  return (
    <>
      <Button
        size="1"
        variant="outline"
        color="red"
        onClick={() => setOpen(true)}
      >
        Refund
      </Button>
      <ConfirmDialog
        open={open}
        onOpenChange={(next) => {
          if (isBusy) return
          setError(null)
          setOpen(next)
        }}
        onConfirm={handleConfirm}
        title="Refund this plan?"
        confirmLabel="Refund"
        loading={isBusy}
        description={
          <Flex direction="column" gap="3">
            <Text size="2">
              This refunds their last plan payment and returns them to Free, or
              to Pro if it was a Team upgrade. Their outreach credit goes to $0.
            </Text>
            <Text size="2">
              {days === null
                ? 'We have no purchase date for this plan.'
                : `Bought ${days} ${days === 1 ? 'day' : 'days'} ago. The refund window is ${PLAN_PRICING.refundWindowDays} days.`}
            </Text>
            {outsideWindow && (
              <Callout.Root color="amber">
                <Callout.Text>
                  This is outside the refund window. You can still refund it.
                </Callout.Text>
              </Callout.Root>
            )}
            {error && (
              <Callout.Root color="red">
                <Callout.Text>{error}</Callout.Text>
              </Callout.Root>
            )}
          </Flex>
        }
      />
    </>
  )
}
