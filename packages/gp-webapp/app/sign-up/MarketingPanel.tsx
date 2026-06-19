import { type LucideIcon, ClipboardList, Megaphone } from 'lucide-react'
import { cn } from '@styleguide'

const FeatureBlock = ({
  icon: Icon,
  title,
  description,
}: {
  icon: LucideIcon
  title: string
  description: string
}) => (
  <div className="flex max-w-[280px] flex-col gap-1.5">
    <Icon
      className="size-6 text-[#0a0a0a]"
      strokeWidth={2}
      aria-hidden="true"
    />
    <h3 className="text-base font-semibold text-[#0a0a0a]">{title}</h3>
    <p className="text-sm leading-6 text-muted-foreground">{description}</p>
  </div>
)

export default function MarketingPanel({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        'relative overflow-hidden bg-[linear-gradient(135deg,#e6f0ff_0%,#eef1f8_45%,#fcecdd_100%)] px-6 py-12 lg:px-20 lg:py-24',
        className,
      )}
    >
      <div className="mx-auto flex max-w-[600px] flex-col gap-10 lg:mx-0">
        <header className="flex flex-col gap-3">
          <h2 className="text-[32px] leading-[40px] font-bold text-[#0a0a0a] font-[family-name:var(--outfit-font)]">
            Your Path to Victory. 100% Free.
          </h2>
          <p className="text-sm leading-5 text-muted-foreground">
            Get your winning plan. Built for you. Ready in 2 mins.
          </p>
        </header>

        <div className="flex flex-col gap-8 lg:grid lg:grid-cols-2 lg:items-start lg:gap-x-8">
          <div className="flex flex-col gap-6">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/images/sign-up/stat-card.png"
              alt=""
              aria-hidden="true"
              width={302}
              height={278}
              className="w-[280px] max-w-full drop-shadow-sm"
            />
            <FeatureBlock
              icon={ClipboardList}
              title="Campaign Plan"
              description="Get a free, step-by-step plan to win your race"
            />
          </div>

          <div className="flex flex-col gap-6 lg:-mt-12">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/images/sign-up/voter-demographics-card.png"
              alt=""
              aria-hidden="true"
              width={303}
              height={327}
              className="w-[290px] max-w-full drop-shadow-sm"
            />
            <FeatureBlock
              icon={Megaphone}
              title="Data + Outreach"
              description="Reach your target voters with precision texting and door lists."
            />
          </div>
        </div>
      </div>
    </div>
  )
}
