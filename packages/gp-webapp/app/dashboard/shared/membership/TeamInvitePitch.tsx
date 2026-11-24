import { Badge } from '@styleguide'
import { CheckIcon, UsersIcon } from '@styleguide/components/ui/icons'
import ProPitchPanel from 'app/dashboard/outreach/v2/gate/ProPitchPanel'
import type { teamInvitePitchCopy } from './membershipCopy'

interface TeamInvitePitchProps {
  copy: ReturnType<typeof teamInvitePitchCopy>
  // The verification card only sells texting, so the Pro cross-sell leaves it
  // out (Pro already has it) and a closed texting race has nothing to show.
  showVerification: boolean
}

// The invite pitch body (design: G-AcctTeamProInvite and ...InviteCross): the
// gate panel's layout, a users-icon headline row over check bullets.
export const TeamInvitePitch = ({
  copy,
  showVerification,
}: TeamInvitePitchProps): React.JSX.Element => (
  <div className="flex w-full flex-col gap-4 text-left">
    <div className="overflow-hidden rounded-xl border border-brand-blue-200">
      <div className="flex items-center gap-3.5 bg-brand-blue-200/45 p-4 sm:p-5">
        <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-brand-blue-200">
          <UsersIcon className="size-5 text-foreground" aria-hidden />
        </span>
        <p className="font-semibold">{copy.headline}</p>
      </div>
      <ul className="flex flex-col gap-3.5 px-5 pt-4 pb-5 sm:px-6 sm:pt-5 sm:pb-6">
        {copy.bullets.map(({ text, bonus }) => (
          <li key={text} className="flex items-center gap-3">
            <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-brand-blue-200/55">
              <CheckIcon className="size-4 text-foreground" aria-hidden />
            </span>
            <span className="text-base leading-normal">{text}</span>
            {bonus && (
              <Badge variant="soft" shape="pill">
                Bonus
              </Badge>
            )}
          </li>
        ))}
      </ul>
    </div>
    {showVerification && <ProPitchPanel channel="sms" hideValue />}
  </div>
)
