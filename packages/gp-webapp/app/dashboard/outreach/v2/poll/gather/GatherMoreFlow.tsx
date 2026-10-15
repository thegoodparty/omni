import { useEffect, useRef, useState } from 'react'
import { FetchError } from 'ofetch'
import {
  PRICE_PER_TEXT,
  type ServePollExpansionCreateResponse,
} from '@goodparty_org/contracts'
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  Card,
  Input,
  Spinner,
  cn,
} from '@styleguide'
import {
  CircleAlertIcon,
  CalendarClockIcon,
  CircleCheckIcon,
  InfoIcon,
} from '@styleguide/components/ui/icons'
import { clientRequest } from 'gpApi/typed-request'
import { useTotalConstituentsWithCellPhone } from 'app/dashboard/polls/shared/audience-selection'
import { OUTREACH_TYPES } from 'app/dashboard/outreach/constants'
import CheckoutPayment from 'app/dashboard/purchase/components/CheckoutPayment'
import PurchaseError from 'app/dashboard/purchase/components/PurchaseError'
import {
  CheckoutSessionProvider,
  useCheckoutSession,
} from 'app/dashboard/purchase/components/CheckoutSessionProvider'
import { completeCheckoutSession } from 'app/dashboard/purchase/utils/purchaseFetch.utils'
import { PURCHASE_TYPES } from 'helpers/purchaseTypes'
import { OutreachFlowShell, type FlowShellCta } from '../../OutreachFlowShell'
import { ChannelBadge } from '../../channelMeta'
import { Intro } from '../../social/Intro'
import { SERVE_GATHER_COPY } from './gatherCopy'
import {
  gatherSize,
  remainingConstituents,
  type GatherOption,
} from './gatherSize.util'

type StepId = 'size' | 'when' | 'review'

const STEP_ORDER: StepId[] = ['size', 'when', 'review']

// The checkout-session endpoint reports dollars.
const money = (dollars: number): string => dollars.toFixed(2)

const createErrorMessage = (error: unknown): string => {
  if (error instanceof FetchError) {
    const message: unknown = error.data?.message
    if (typeof message === 'string') return message
  }
  return SERVE_GATHER_COPY.createFailed
}

const OptionCard = ({
  selected,
  onSelect,
  title,
  body,
  price,
  children,
}: {
  selected: boolean
  onSelect: () => void
  title: string
  body: string
  price?: string
  children?: React.ReactNode
}) => (
  <Card
    role="button"
    tabIndex={0}
    aria-pressed={selected}
    onClick={onSelect}
    onKeyDown={(e) => {
      if (e.target !== e.currentTarget) return
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        onSelect()
      }
    }}
    className={cn(
      'cursor-pointer gap-1 p-4 transition-colors',
      selected ? 'border-primary' : 'hover:border-primary/50',
    )}
  >
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <p className="font-medium text-foreground">{title}</p>
        <p className="text-sm text-muted-foreground">{body}</p>
      </div>
      {price && (
        <span className="shrink-0 text-sm font-semibold text-foreground">
          {price}
        </span>
      )}
    </div>
    {children}
  </Card>
)

const ReviewStep = ({
  created,
  onPaid,
}: {
  created: ServePollExpansionCreateResponse
  onPaid: () => Promise<void>
}) => {
  const { checkoutSession, error, setError, fetchClientSecret } =
    useCheckoutSession()
  const [liveTotalDollars, setLiveTotalDollars] = useState<number | null>(null)
  const [cardError, setCardError] = useState<string | null>(null)
  const [payFailed, setPayFailed] = useState(false)
  const fetched = useRef(false)

  useEffect(() => {
    if (fetched.current) return
    fetched.current = true
    fetchClientSecret().catch(() => {
      // Surfaced through the provider's error state below.
    })
  }, [fetchClientSecret])

  const sessionError = Boolean(error) && !checkoutSession
  const inlineCardError = cardError ?? (checkoutSession ? error : null)
  const totalDollars =
    liveTotalDollars ?? checkoutSession?.amount ?? created.amountCents / 100

  const handlePaid = async (sessionId: string) => {
    setCardError(null)
    setError(null)
    const response = await completeCheckoutSession(sessionId)
    if (!response.ok) {
      // The card is already charged, so this is not a card problem.
      setPayFailed(true)
      throw new Error('Failed to complete purchase')
    }
    await onPaid()
  }

  return (
    <div className="space-y-6">
      <Intro
        title={SERVE_GATHER_COPY.steps.review}
        body={SERVE_GATHER_COPY.review.caption}
      />
      <Card className="gap-0 overflow-hidden p-0">
        <div className="px-4 py-4">
          <p className="font-medium text-foreground">
            {SERVE_GATHER_COPY.review.cardTitle}
          </p>
        </div>
        <dl className="space-y-1.5 border-t border-border px-4 py-4 text-sm">
          <div className="flex justify-between gap-4">
            <dt className="text-muted-foreground">
              {SERVE_GATHER_COPY.review.recipients}
            </dt>
            <dd className="text-foreground">
              {created.recipientCount.toLocaleString()}
            </dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-muted-foreground">
              {SERVE_GATHER_COPY.review.price}
            </dt>
            <dd className="text-foreground">${PRICE_PER_TEXT.toFixed(3)}</dd>
          </div>
        </dl>
        <div className="flex items-center justify-between border-t border-border px-4 py-4">
          <span className="font-medium text-foreground">
            {SERVE_GATHER_COPY.review.total}
          </span>
          <span className="font-semibold text-foreground">
            ${money(totalDollars)}
          </span>
        </div>
      </Card>
      {payFailed ? (
        <PurchaseError />
      ) : sessionError ? (
        <Card className="items-start gap-3 border-destructive p-4">
          <p className="text-sm text-foreground">
            {SERVE_GATHER_COPY.review.prepareFailed}
          </p>
        </Card>
      ) : !checkoutSession ? (
        <div className="flex justify-center py-6">
          <Spinner />
        </div>
      ) : (
        <>
          <Card className="gap-3 p-4">
            <p className="font-medium text-foreground">
              {SERVE_GATHER_COPY.review.paymentTitle}
            </p>
            <CheckoutPayment
              onPaymentSuccess={handlePaid}
              onPaymentError={setCardError}
              onTotalChange={setLiveTotalDollars}
            />
          </Card>
          {inlineCardError && (
            <Alert
              variant="destructive"
              icon={<CircleAlertIcon className="size-4" />}
            >
              <AlertTitle>{SERVE_GATHER_COPY.review.cardFailed}</AlertTitle>
              <AlertDescription>{inlineCardError}</AlertDescription>
            </Alert>
          )}
          <Alert variant="info" icon={<InfoIcon className="size-4" />}>
            <AlertTitle>
              {SERVE_GATHER_COPY.review.dueToday(money(totalDollars))}
            </AlertTitle>
            <AlertDescription>
              {SERVE_GATHER_COPY.review.dueTodayBody}
            </AlertDescription>
          </Alert>
        </>
      )}
    </div>
  )
}

interface GatherMoreFlowProps {
  open: boolean
  onClose: () => void
  outreachId: number
  // Everyone the poll has already texted, and how many answered.
  sent: number
  responses: number
  // Runs once the payment has gone through, so the page can show the new
  // expansion in review.
  onPaid: () => Promise<unknown> | void
}

// Gather more feedback: how many, when, review and pay. The expansion row is
// written when the official leaves "when" and the review step prices exactly
// that row. There is no Back off review: an unpaid expansion holds the next
// one off, so editing the size would meet its own leftover.
export const GatherMoreFlow = ({
  open,
  onClose,
  outreachId,
  sent,
  responses,
  onPaid,
}: GatherMoreFlowProps) => {
  const constituents = useTotalConstituentsWithCellPhone()
  const totalConstituents = constituents.data?.totalConstituents ?? null
  const countsLoading = constituents.isPending && !constituents.isUnavailable

  const [stepId, setStepId] = useState<StepId>('size')
  const [option, setOption] = useState<GatherOption | null>(null)
  const [budget, setBudget] = useState('')
  const [created, setCreated] =
    useState<ServePollExpansionCreateResponse | null>(null)
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)
  const [paid, setPaid] = useState(false)

  useEffect(() => {
    if (!open) return
    setStepId('size')
    setOption(null)
    setBudget('')
    setCreated(null)
    setCreating(false)
    setCreateError(null)
    setPaid(false)
  }, [open])

  const budgetDollars = Number(budget)
  const sizeInput = {
    totalConstituents,
    sent,
    responses,
    budgetDollars: Number.isFinite(budgetDollars) ? budgetDollars : 0,
  }
  const minSize = gatherSize('min', sizeInput)
  const allSize = gatherSize('all', sizeInput)
  const budgetSize = gatherSize('budget', sizeInput)
  const remaining = remainingConstituents(totalConstituents, sent)
  const exhausted = remaining === 0
  const showMin = minSize > 0
  const showAll = allSize > 0
  const defaultOption: GatherOption = showMin
    ? 'min'
    : showAll
      ? 'all'
      : 'budget'
  const selected = option ?? defaultOption
  const size =
    selected === 'min' ? minSize : selected === 'all' ? allSize : budgetSize

  const priceFor = (count: number): string =>
    SERVE_GATHER_COPY.size.price((count * PRICE_PER_TEXT).toFixed(2))

  const createExpansion = async () => {
    if (creating) return
    setCreating(true)
    setCreateError(null)
    try {
      const { data } = await clientRequest(
        'POST /v1/outreach/serve/poll/:id/expansions',
        { id: String(outreachId), size },
      )
      setCreated(data)
      setStepId('review')
    } catch (error) {
      setCreateError(createErrorMessage(error))
    } finally {
      setCreating(false)
    }
  }

  const handlePaid = async () => {
    setPaid(true)
    await onPaid()
  }

  const stepIndex = STEP_ORDER.indexOf(stepId)
  const cta: FlowShellCta | null = paid
    ? null
    : stepId === 'size'
      ? {
          label: 'Continue',
          onClick: () => setStepId('when'),
          disabled: size < 1 || exhausted,
        }
      : stepId === 'when'
        ? {
            label: 'Continue',
            onClick: () => {
              void createExpansion()
            },
            loading: creating,
          }
        : null

  return (
    <OutreachFlowShell
      open={open}
      onClose={onClose}
      title={paid ? 'Done' : SERVE_GATHER_COPY.steps[stepId]}
      headerBadge={<ChannelBadge type="poll" />}
      settled={paid}
      currentStep={stepIndex + 1}
      totalSteps={paid ? 0 : STEP_ORDER.length}
      onBack={
        !paid && stepId === 'when' && !creating
          ? () => setStepId('size')
          : undefined
      }
      cta={cta}
      dirty={!paid && created !== null}
    >
      {paid ? (
        <div className="space-y-6 py-8 text-center">
          <div className="flex justify-center">
            <span className="flex size-16 items-center justify-center rounded-full bg-primary-light">
              <CircleCheckIcon className="size-8 text-primary" />
            </span>
          </div>
          <div className="space-y-2">
            <h2 className="text-2xl font-semibold text-foreground">
              {SERVE_GATHER_COPY.success.title}
            </h2>
            <p className="text-muted-foreground">
              {SERVE_GATHER_COPY.success.body}
            </p>
            {created && (
              <p className="text-muted-foreground">
                {SERVE_GATHER_COPY.success.reach(
                  created.recipientCount.toLocaleString(),
                )}
              </p>
            )}
          </div>
          <Button size="large" className="w-full" onClick={onClose}>
            {SERVE_GATHER_COPY.success.action}
          </Button>
        </div>
      ) : stepId === 'size' ? (
        <div className="space-y-6">
          <Intro
            title={SERVE_GATHER_COPY.steps.size}
            body={SERVE_GATHER_COPY.size.caption}
          />
          {countsLoading ? (
            <div className="flex items-center gap-3 py-6">
              <Spinner />
              <p className="text-sm text-muted-foreground">
                {SERVE_GATHER_COPY.size.loading}
              </p>
            </div>
          ) : exhausted ? (
            <p className="text-sm text-muted-foreground">
              {SERVE_GATHER_COPY.size.exhausted}
            </p>
          ) : (
            <div className="space-y-3">
              {showMin && (
                <OptionCard
                  selected={selected === 'min'}
                  onSelect={() => setOption('min')}
                  title={SERVE_GATHER_COPY.size.min.title(
                    minSize.toLocaleString(),
                  )}
                  body={SERVE_GATHER_COPY.size.min.body}
                  price={priceFor(minSize)}
                />
              )}
              {showAll && (
                <OptionCard
                  selected={selected === 'all'}
                  onSelect={() => setOption('all')}
                  title={SERVE_GATHER_COPY.size.all.title(
                    allSize.toLocaleString(),
                  )}
                  body={SERVE_GATHER_COPY.size.all.body}
                  price={priceFor(allSize)}
                />
              )}
              <OptionCard
                selected={selected === 'budget'}
                onSelect={() => setOption('budget')}
                title={SERVE_GATHER_COPY.size.budget.title}
                body={SERVE_GATHER_COPY.size.budget.body}
              >
                {selected === 'budget' && (
                  <div className="mt-2 space-y-2">
                    <Input
                      type="number"
                      inputMode="decimal"
                      min={0}
                      step="0.01"
                      aria-label={SERVE_GATHER_COPY.size.budget.label}
                      value={budget}
                      onChange={(e) => setBudget(e.target.value)}
                    />
                    <p className="text-sm font-medium text-foreground">
                      {SERVE_GATHER_COPY.size.budget.reach(
                        budgetSize.toLocaleString(),
                      )}
                    </p>
                  </div>
                )}
              </OptionCard>
            </div>
          )}
          <p className="text-sm text-muted-foreground">
            {SERVE_GATHER_COPY.size.perText(PRICE_PER_TEXT.toFixed(3))}
          </p>
        </div>
      ) : stepId === 'when' ? (
        <div className="space-y-6">
          <Intro
            title={SERVE_GATHER_COPY.steps.when}
            body={SERVE_GATHER_COPY.when.caption}
          />
          <Alert variant="info" icon={<CalendarClockIcon className="size-4" />}>
            <AlertTitle>{SERVE_GATHER_COPY.when.alertTitle}</AlertTitle>
            <AlertDescription>
              {SERVE_GATHER_COPY.when.alertBody}
            </AlertDescription>
          </Alert>
          {createError && (
            <Alert
              variant="destructive"
              role="alert"
              icon={<CircleAlertIcon className="size-4" />}
            >
              <AlertDescription>{createError}</AlertDescription>
            </Alert>
          )}
        </div>
      ) : created ? (
        <CheckoutSessionProvider
          key={created.expansionId}
          type={PURCHASE_TYPES.SERVE_TEXT}
          purchaseMetaData={{
            contactCount: created.recipientCount,
            outreachType: OUTREACH_TYPES.text,
            outreachId,
            expansionId: created.expansionId,
          }}
        >
          <ReviewStep created={created} onPaid={handlePaid} />
        </CheckoutSessionProvider>
      ) : null}
    </OutreachFlowShell>
  )
}
