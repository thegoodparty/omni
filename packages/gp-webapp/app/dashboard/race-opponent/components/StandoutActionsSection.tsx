'use client'

import { useRouter } from 'next/navigation'
import { Button } from '@styleguide'
import { SendIcon } from '@styleguide/components/ui/icons'
import type { RaceOpponentStandoutAction } from 'gpApi/api-endpoints'

type Props = {
  standoutActions: RaceOpponentStandoutAction[] | null | undefined
}

// The "N ways to stand out" action cards below the field SWOT (ENG-10650).
// Each card carries an agent-drafted SMS; the CTA deep-links into the outreach
// text composer with that message preset (`compose=text&message=...`), which
// applies the same Pro/compliance gates as the manual path. Renders nothing
// while the actions run is still in flight or after it failed (empty/absent
// standoutActions) — the brief simply ends at the SWOT.
const StandoutActionsSection = ({
  standoutActions,
}: Props): React.JSX.Element | null => {
  const router = useRouter()
  if (!standoutActions || standoutActions.length === 0) return null

  return (
    <section className="mx-auto mt-4 w-full max-w-[608px]">
      <h2 className="text-lg font-semibold text-foreground">
        {standoutActions.length} {standoutActions.length === 1 ? 'way' : 'ways'}{' '}
        to stand out
      </h2>
      <p className="text-sm text-muted-foreground">
        These actions will help you show voters where you stand out against the
        opposition.
      </p>
      <div className="mt-4 flex flex-col gap-4">
        {standoutActions.map((action, index) => (
          <div
            key={`${action.title}-${index}`}
            className="flex min-w-0 flex-col gap-3 rounded-xl border border-border bg-card p-4 md:p-6"
          >
            <span className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-primary">
              <SendIcon className="h-4 w-4" aria-hidden />
              Voter outreach
            </span>
            <h3 className="min-w-0 break-words text-lg font-semibold text-foreground">
              {action.title}
            </h3>
            <p className="min-w-0 whitespace-pre-wrap break-words text-sm text-foreground">
              {action.body}
            </p>
            <Button
              className="w-full"
              onClick={() =>
                router.push(
                  `/dashboard/outreach?compose=text&message=${encodeURIComponent(action.smsMessage)}`,
                )
              }
            >
              Send SMS to voters
            </Button>
          </div>
        ))}
      </div>
    </section>
  )
}

export default StandoutActionsSection
