import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { ProReceipt } from '@goodparty_org/contracts'
import { Button } from '@styleguide'
import {
  ChevronDownIcon,
  ChevronUpIcon,
  DownloadIcon,
} from '@styleguide/components/ui/icons'
import { clientRequest } from 'gpApi/typed-request'

export const PRO_RECEIPT_QUERY_KEY = ['pro-receipt']

const cardBrandLabel = (brand: string) =>
  brand.charAt(0).toUpperCase() + brand.slice(1)

const formatDate = (date: Date) =>
  date.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
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

// Design: receiptCard — the paid screen's collapsed "Your receipt" row that
// opens into the date, the plan line, the card and the charge, with Stripe's
// receipt behind Download. The subscription reaches the campaign through the
// completion webhook, so the read waits for the caller to see Pro land, and
// nothing draws until Stripe answers: a receipt is never made up.
export const ProReceiptCard = ({
  enabled,
}: {
  enabled: boolean
}): React.JSX.Element | null => {
  const [open, setOpen] = useState(false)
  const { data: receipt } = useQuery({
    queryKey: PRO_RECEIPT_QUERY_KEY,
    queryFn: async (): Promise<ProReceipt> => {
      const { data } = await clientRequest(
        'GET /v1/payments/purchase/pro-receipt',
        {},
      )
      return data
    },
    enabled,
    retry: false,
    staleTime: 5 * 60 * 1000,
  })

  if (!receipt) return null

  const amount = `$${receipt.amount.toFixed(2)}`
  const paidAt = receipt.paidAt ? new Date(receipt.paidAt) : new Date()
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
          <Row label="Date" value={formatDate(paidAt)} />
          <Row
            label="Pro subscription, recurring monthly"
            value={`${amount}/mo`}
          />
          {receipt.cardBrand && receipt.cardLast4 && (
            <Row
              label="Card"
              value={`${cardBrandLabel(receipt.cardBrand)} •••• ${receipt.cardLast4}`}
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
