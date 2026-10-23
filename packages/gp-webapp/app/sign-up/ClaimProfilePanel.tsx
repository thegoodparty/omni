import { cn } from '@styleguide'
import {
  ChartColumnIncreasingIcon,
  PenLineIcon,
  UserRoundIcon,
} from '@styleguide/components/ui/icons'

// Figma: Sign-up page - Voter Guide (2636:129481 desktop, 2643:130227 mobile).
// Not personalized: the page does not know which profile the visitor came from.
const FEATURES = [
  {
    Icon: UserRoundIcon,
    title: 'Verify your identity',
    description: "Confirm you're the elected official or candidate.",
  },
  {
    Icon: PenLineIcon,
    title: 'Update your profile',
    description: 'Keep your bio, positions, and accomplishments up to date.',
  },
  {
    Icon: ChartColumnIncreasingIcon,
    title: 'Reach more voters',
    description: 'Help your community learn more about your work and views.',
  },
]

export default function ClaimProfilePanel({
  className,
}: {
  className?: string
}) {
  return (
    <div
      data-testid="claim-profile-panel"
      className={cn(
        'flex flex-col items-center justify-center gap-8 bg-radial-[ellipse_100%_100%_at_50%_0%] from-base-background from-0% via-blue-100 via-50% to-red-100 px-6 pt-8 pb-16 text-center lg:items-start lg:from-25% lg:via-63% lg:px-12 lg:py-16 lg:text-left xl:px-20',
        className,
      )}
    >
      <header className="flex flex-col gap-4">
        <p className="font-outfit text-lg font-semibold text-base-muted-foreground">
          Claim your profile
        </p>
        <h2 className="font-outfit text-[2.5rem] leading-13 font-semibold text-base-foreground lg:max-w-130 lg:text-5xl lg:leading-15">
          Claim your voter guide profile
        </h2>
        <p className="text-xl text-black lg:max-w-131">
          Create an account to claim your GoodParty.org profile and keep your
          community informed.
        </p>
      </header>

      <ul className="m-0 flex w-full list-none flex-col gap-6 p-0 text-left lg:max-w-158">
        {FEATURES.map(({ Icon, title, description }) => (
          <li key={title} className="flex items-start gap-4">
            <span className="flex size-12 shrink-0 items-center justify-center rounded-full bg-base-background">
              <Icon
                className="size-6 text-base-foreground"
                aria-hidden="true"
              />
            </span>
            <div className="flex flex-col gap-2 text-base-foreground">
              <h3 className="text-xl font-semibold">{title}</h3>
              <p className="text-lg">{description}</p>
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}
