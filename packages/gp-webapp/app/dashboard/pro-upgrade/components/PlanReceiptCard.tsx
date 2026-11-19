import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { PlanReceipt } from '@goodparty_org/contracts'
import { Button } from '@styleguide'
import {
  ChevronDownIcon,
  ChevronUpIcon,
  DownloadIcon,
} from '@styleguide/components/ui/icons'
import { clientRequest } from 'gpApi/typed-request'
import type { ProUpgradePlan } from '../proUpgradePlanParams'

export const PLAN_RECEIPT_QUERY_KEY = ['plan-receipt']

// The plan reaches the campaign through the purchase completing, so the read
// waits for the caller to see the paid plan land, and 404 (no paid plan yet)
// is just "no receipt".
export const usePlanReceipt = (enabled: boolean): PlanReceipt | undefined =>
  useQuery({
    queryKey: PLAN_RECEIPT_QUERY_KEY,
    queryFn: async (): Promise<PlanReceipt> => {
      const { data } = await clientRequest(
        'GET /v1/payments/purchase/plan-receipt',
        {},
      )
      return data
    },
    enabled,
    retry: false,
  }).data

const cardBrandLabel = (brand: string) =>
  brand.charAt(0).toUpperCase() + brand.slice(1)

export const formatReceiptDate = (date: Date) =>
  date.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })

export const formatGoodThrough = (iso: string) =>
  new Date(iso).toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  })

const Row = ({
  label,
  value,
}: {
  label: string
  value: string
}): React.JSX.Element => (
  <div className="flex items-center justify-between gap-3 text-sm">
    <span className="text-base-muted-foreground">{label}</span>
    <span className="font-medium">{value}</span>
  </div>
)

// Design: the paid screen's collapsed "Your receipt" row, as a one-time
// charge: no "/mo", and the date the plan stays good through. Nothing draws
// until gp-api answers, so a receipt is never made up. A promo that covered
// the plan in full has no card and no Stripe receipt, so those rows drop out.
export const PlanReceiptCard = ({
  receipt,
  plan,
}: {
  receipt: PlanReceipt | undefined
  plan: ProUpgradePlan
}): React.JSX.Element | null => {
  const [open, setOpen] = useState(false)
  if (!receipt) return null

  const amount = `$${(receipt.amountCents / 100).toFixed(2)}`
  const paidAt = new Date(receipt.paidAt)
  const chargedToday = paidAt.toDateString() === new Date().toDateString()

  return (
    <div className="relative rounded-xl border border-base-border bg-card p-4">
      <button
        type="button"
        className="flex w-full items-center justify-between gap-3 text-left"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <span className="text-[15px] font-semibold">Your receipt</span>
        <span className="flex items-center gap-2">
          <span className="text-[15px] font-semibold">{amount}</span>
          {open ? (
            <ChevronUpIcon
              className="size-4 text-base-muted-foreground"
              aria-hidden
            />
          ) : (
            <ChevronDownIcon
              className="size-4 text-base-muted-foreground"
              aria-hidden
            />
          )}
        </span>
      </button>
      {open && (
        <div className="mt-2.5 flex flex-col gap-2.5">
          <div className="h-px bg-base-border" />
          <Row label="Date" value={formatReceiptDate(paidAt)} />
          <Row
            label={plan === 'team' ? 'Team plan' : 'Pro plan'}
            value={amount}
          />
          {receipt.cardBrand && receipt.cardLast4 && (
            <Row
              label="Card"
              value={`${cardBrandLabel(receipt.cardBrand)} •••• ${receipt.cardLast4}`}
            />
          )}
          {receipt.planEndsAt && (
            <Row
              label="Good through"
              value={formatGoodThrough(receipt.planEndsAt)}
            />
          )}
          <div className="h-px bg-base-border" />
          <div className="flex items-center justify-between gap-3 text-[15px] font-semibold">
            <span>{chargedToday ? 'Charged today' : 'Charged'}</span>
            <span>{amount}</span>
          </div>
          {receipt.receiptUrl && (
            <div className="mt-1 flex sm:justify-end">
              <Button
                variant="outline"
                size="small"
                className="w-full sm:w-auto"
                onClick={() =>
                  window.open(receipt.receiptUrl ?? '', '_blank', 'noopener')
                }
              >
                <DownloadIcon aria-hidden /> Download receipt
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
