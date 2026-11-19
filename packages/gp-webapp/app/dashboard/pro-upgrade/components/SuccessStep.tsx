'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import { PLAN_PRICING } from '@goodparty_org/contracts'
import { Button, ProBadge, Spinner } from '@styleguide'
import { Alert, AlertTitle } from '@styleguide/components/ui/alert'
import { StepFooter } from 'app/dashboard/shared/StepFooter'
import {
  CheckCircleIcon,
  CheckIcon,
  ClipboardListIcon,
  InfoIcon,
  ShieldCheckIcon,
} from '@styleguide/components/ui/icons'
import {
  CAMPAIGN_QUERY_KEY,
  fetchCampaign,
} from '@shared/hooks/CampaignProvider'
import {
  TCR_COMPLIANCE_QUERY_KEY,
  getTcrCompliance,
  getTcrComplianceStatusCompletions,
} from 'app/dashboard/profile/texting-compliance/util/tcrCompliance.util'
import {
  PIN_NOTICE_BODY,
  PIN_NOTICE_TITLE,
  SMS_CUTOFF_COPY,
  SUBMITTED_BODY,
  formatSmsCutoffDate,
} from 'app/dashboard/campaign-verification/verificationCopy'
import { useSmsCompliance } from 'app/dashboard/shared/smsCutoff/useSmsCompliance'
import { usePlan } from 'app/dashboard/shared/membership/deriveMembershipState'
import { formatPlanCents } from 'app/dashboard/shared/plan/planPitch'
import { useWinPerCampaignPricingFlag } from 'app/shared/experiments/winPerCampaignPricingFlag'
import { EVENTS, trackEvent } from 'helpers/analyticsHelper'
import { TEAM_SETTINGS_PATH } from '../proUpgradePlanParams'
import { useProUpgradeCarry } from './proUpgradeCarryContext'
import {
  PlanReceiptCard,
  formatGoodThrough,
  usePlanReceipt,
} from './PlanReceiptCard'
import { ConfettiField } from './ConfettiField'
import { ProReceiptCard } from './ProReceiptCard'
import { useProUpgradeWizard } from './ProUpgradeWizard'

// `isPro` flips server-side only when the Stripe `checkout.session.completed`
// webhook lands, which can lag the candidate arriving here. Poll the shared
// campaign query until it flips, then stop — or give up after the webhook
// window so a never-arriving flip doesn't poll forever.
const POLL_INTERVAL_MS = 2000
const POLL_TIMEOUT_MS = 30000

// What the flow unlocks the moment Pro activates; texting still waits on the carriers clearing the campaign.
const UNLOCKED_ROWS = [
  'Individual voter records for your race',
  'Downloads and targeted lists',
  'Door knocking, phone banking and robocalls',
]

const TEAM_UNLOCKED_ROW = 'Logins for your team'

const PLAN_PIN_BODY = `${PIN_NOTICE_BODY.replace(/\.$/, '')} and your ${formatPlanCents(PLAN_PRICING.includedCreditCents)} outreach credit.`

const VERIFICATION_BODY =
  'Your payment went through. One step left before you can send.'

const NEXT_NOUN = {
  robocall: 'schedule your robocall',
  door: 'build your walk list',
  'phone-bank': 'download your call list',
} as const

const NEXT_STEP_BODY = {
  robocall: 'Pick a date and time, review the cost, and pay for the calls.',
  door: 'Build the route, then save your walk list and start knocking.',
  'phone-bank': 'Download your call list, then start calling.',
} as const

// Post-payment landing (Stripe embedded-checkout return_url + PaymentStep's
// on-confirm nav). Purely presentational: it never gates its content on the
// webhook-driven `isPro` flip, so it can't get stuck. It does refresh the shared
// campaign cache in the background so the sidebar's Pro pitch — which reads
// the cached `isPro` — has already moved on when the candidate continues,
// instead of lingering until a manual page refresh. The screen
// does hold its Continue until `isPro` lands (or the poll gives up), because it
// hands off to campaign verification, which reads the Pro state it asserts.
const SuccessStep = (): React.JSX.Element => {
  // `complete` owns where the candidate goes next. On the standalone page that
  // is the Campaign Manager dashboard, where the sidebar's MembershipBanner
  // surfaces PIN entry (then review and approval as the TCR record
  // progresses) once `isPro` flips. The profile page's compliance card is a
  // secondary location (ENG-10361).
  const { channel, complete, exit } = useProUpgradeWizard()
  const router = useRouter()
  const { enabled: planPricing } = useWinPerCampaignPricingFlag(false)
  const { plan: heldPlan } = usePlan()
  const carry = useProUpgradeCarry()
  const isTeam = planPricing && (carry.plan === 'team' || heldPlan === 'team')
  // A Pro holder who bought Team: verification and the credit are already
  // theirs, so only the new thing is listed.
  const fromPro = isTeam && carry.fromPro
  const planName = planPricing && isTeam ? 'Team' : 'Pro'
  const [pollExpired, setPollExpired] = useState(false)

  useEffect(() => {
    trackEvent(EVENTS.ProUpgrade.Compliance.SuccessViewed)
    const timer = setTimeout(() => setPollExpired(true), POLL_TIMEOUT_MS)
    return () => clearTimeout(timer)
  }, [])

  // Same key as CampaignProvider (deduped) so the refetch updates the campaign
  // every consumer reads. `staleTime: 0` fires the first refetch on mount (the
  // webhook may already have landed); the interval stops once Pro or expired.
  const { data } = useQuery({
    queryKey: CAMPAIGN_QUERY_KEY,
    queryFn: fetchCampaign,
    staleTime: 0,
    refetchInterval: (query) =>
      !pollExpired && !query.state.data?.isPro ? POLL_INTERVAL_MS : false,
  })

  const planReceipt = usePlanReceipt(planPricing && Boolean(data?.isPro))

  // The standalone page has no launch channel, and it reads the same as the
  // texting entry point: both end on verification.
  const verificationNext = channel === 'sms' || channel === null

  // gp-api's word is final once the window has closed: whatever the filing
  // says, texting will not open for this race, so a banner replaces the
  // verification row.
  const { smsCompliance, smsCutoffDate } = useSmsCompliance()
  const smsCutoff = verificationNext && smsCompliance === 'closed'

  // Whether this campaign's filing is already in: the wizard collects it
  // before payment now, but an already-Pro candidate who never submitted is
  // routed here too, and still has verification ahead of them.
  const { data: tcrCompliance, isPending: tcrPending } = useQuery({
    queryKey: TCR_COMPLIANCE_QUERY_KEY,
    queryFn: getTcrCompliance,
    enabled: verificationNext && !smsCutoff && !fromPro,
  })
  const filingSubmitted =
    verificationNext &&
    !smsCutoff &&
    getTcrComplianceStatusCompletions(tcrCompliance).filingComplete

  const handleInviteTeam = (): void => {
    trackEvent(EVENTS.ProUpgrade.Compliance.SuccessContinue)
    // Team's reason to exist is the logins, so it lands where they are made:
    // Team Settings with the invite drawer open, or the page it came from.
    const target = carry.returnTo ?? TEAM_SETTINGS_PATH
    router.push(target === TEAM_SETTINGS_PATH ? `${target}?invite=1` : target)
  }

  const handleContinue = (): void => {
    trackEvent(EVENTS.ProUpgrade.Compliance.SuccessContinue)
    // The route shell's `complete` is campaign verification, which a
    // submitted filing has nothing left to do in. Inside an outreach flow
    // `complete` hands back to the gate, which moves on to its own notice.
    if (filingSubmitted && channel === null) {
      exit()
      return
    }
    complete()
  }

  // A disabled query stays pending, so only the verification launches wait.
  if (verificationNext && !smsCutoff && !fromPro && tcrPending) {
    return (
      <div className="flex flex-1 items-center justify-center py-16">
        <Spinner />
      </div>
    )
  }

  const nextStep = verificationNext
    ? null
    : { noun: NEXT_NOUN[channel], body: NEXT_STEP_BODY[channel] }

  // Design: the "paid" screen — confetti through the column, the PRO badge
  // in its circle, the unlocked / still-to-do card, and a footer of Finish
  // later beside the next step, pinned to the bottom of the host's column.
  return (
    <div className="relative flex min-h-full flex-1 flex-col gap-3">
      <ConfettiField />
      <div className="relative flex flex-col items-center gap-4 pt-2 text-center">
        <span className="flex size-16 shrink-0 items-center justify-center rounded-full bg-primary-light">
          {planName === 'Team' ? (
            <CheckCircleIcon className="size-8 text-primary" aria-hidden />
          ) : (
            <ProBadge />
          )}
        </span>
        <div className="flex max-w-[440px] flex-col items-center gap-2">
          <h1 className="text-2xl font-semibold">{`Welcome to ${planName}`}</h1>
          <p className="text-[15px] leading-relaxed text-base-muted-foreground">
            {fromPro
              ? 'Payment successful.'
              : nextStep
                ? `Payment successful. Your next step is to ${nextStep.noun}.`
                : smsCutoff
                  ? SMS_CUTOFF_COPY.successClosedBody
                  : filingSubmitted
                    ? SUBMITTED_BODY
                    : VERIFICATION_BODY}
          </p>
        </div>
      </div>

      <div className="relative overflow-hidden rounded-xl border border-base-border bg-card text-left">
        <div className="flex items-start gap-3 px-4 py-3.5">
          <CheckCircleIcon
            className="mt-0.5 size-[18px] shrink-0 text-primary"
            aria-hidden
          />
          <div className="flex min-w-0 flex-col gap-2">
            <p className="font-semibold">Unlocked now</p>
            <ul className="flex flex-col gap-1.5">
              {(fromPro
                ? [TEAM_UNLOCKED_ROW]
                : isTeam
                  ? [TEAM_UNLOCKED_ROW, ...UNLOCKED_ROWS]
                  : UNLOCKED_ROWS
              ).map((row) => (
                <li
                  key={row}
                  className="flex items-start gap-2 text-sm text-base-muted-foreground"
                >
                  <CheckIcon
                    className="mt-0.5 size-3.5 shrink-0 text-primary"
                    aria-hidden
                  />
                  {row}
                </li>
              ))}
            </ul>
          </div>
        </div>
        {fromPro && (
          <div className="flex items-start gap-3 border-t border-base-border px-4 py-3.5">
            <ShieldCheckIcon
              className="mt-0.5 size-[18px] shrink-0 text-primary"
              aria-hidden
            />
            <div className="flex min-w-0 flex-col gap-2">
              <p className="font-semibold">Everything from Pro stays</p>
              <p className="text-sm text-base-muted-foreground">
                {`Your outreach credit, lists and texts stay as they are.${planReceipt?.planEndsAt ? ` Still good through ${formatGoodThrough(planReceipt.planEndsAt)}.` : ''}`}
              </p>
            </div>
          </div>
        )}
        {!smsCutoff && !fromPro && (
          <div className="flex items-start gap-3 border-t border-base-border px-4 py-3.5">
            {nextStep ? (
              <ClipboardListIcon
                className="mt-0.5 size-[18px] shrink-0 text-primary"
                aria-hidden
              />
            ) : (
              <ShieldCheckIcon
                className="mt-0.5 size-[18px] shrink-0 text-primary"
                aria-hidden
              />
            )}
            <div className="flex min-w-0 flex-col gap-2">
              <p className="font-semibold">
                {nextStep
                  ? `Still to do: ${nextStep.noun}`
                  : filingSubmitted
                    ? PIN_NOTICE_TITLE
                    : 'Still to do: verification'}
              </p>
              <p className="text-sm text-base-muted-foreground">
                {nextStep
                  ? nextStep.body
                  : filingSubmitted
                    ? planPricing
                      ? PLAN_PIN_BODY
                      : PIN_NOTICE_BODY
                    : 'Add your campaign filing details, we register your texting account with the carriers, and you get a PIN when it clears, usually 1 to 2 weeks.'}
              </p>
            </div>
          </div>
        )}
      </div>

      {smsCutoff && (
        <Alert variant="info" icon={<InfoIcon />}>
          <AlertTitle>
            {SMS_CUTOFF_COPY.closedReason(
              smsCutoffDate ? formatSmsCutoffDate(smsCutoffDate) : null,
            )}
          </AlertTitle>
        </Alert>
      )}

      {planPricing ? (
        <PlanReceiptCard
          receipt={planReceipt}
          plan={planName === 'Team' ? 'team' : 'pro'}
        />
      ) : (
        <ProReceiptCard enabled={Boolean(data?.isPro)} />
      )}

      {isTeam ? (
        <StepFooter align="center">
          <Button
            size="large"
            className="w-full sm:w-auto sm:min-w-[360px]"
            onClick={handleInviteTeam}
          >
            {carry.returnTo && carry.returnTo !== TEAM_SETTINGS_PATH
              ? 'Continue'
              : 'Invite your team'}
          </Button>
        </StepFooter>
      ) : smsCutoff ? (
        <StepFooter align="center">
          <Button
            size="large"
            className="w-full sm:w-auto sm:min-w-[360px]"
            onClick={handleContinue}
            disabled={!data?.isPro && !pollExpired}
          >
            {SMS_CUTOFF_COPY.goToDashboard}
          </Button>
        </StepFooter>
      ) : !nextStep && filingSubmitted ? (
        // Nothing is left to do here, so the one action is the way on
        // (design: the pending screen's single centered button).
        <StepFooter align="center">
          <Button
            size="large"
            className="w-full sm:w-auto sm:min-w-[360px]"
            onClick={handleContinue}
            disabled={!data?.isPro && !pollExpired}
          >
            {channel === null ? 'Done' : 'Continue'}
          </Button>
        </StepFooter>
      ) : (
        <StepFooter>
          <Button
            variant="ghost"
            size="large"
            className="w-full sm:w-auto"
            onClick={exit}
          >
            Finish later
          </Button>
          <Button
            size="large"
            className="w-full sm:w-auto sm:min-w-[360px]"
            onClick={handleContinue}
            disabled={!data?.isPro && !pollExpired}
          >
            {nextStep ? 'Continue' : 'Start verification'}
          </Button>
        </StepFooter>
      )}
    </div>
  )
}

export default SuccessStep
