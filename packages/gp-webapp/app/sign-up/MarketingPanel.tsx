import { type LucideIcon, ClipboardList, Megaphone } from 'lucide-react'
import { cn } from '@styleguide'
import StatCard from './StatCard'
import VoterDemographicsCard from './VoterDemographicsCard'

const FeatureBlock = ({
  icon: Icon,
  title,
  description,
}: {
  icon: LucideIcon
  title: string
  description: string
}) => (
  <div className="flex w-full max-w-[280px] flex-col gap-1">
    <Icon
      className="size-6 text-[#0a0a0a]"
      strokeWidth={2}
      aria-hidden="true"
    />
    <h3 className="text-base font-bold text-[#0a0a0a]">{title}</h3>
    <p className="text-base leading-6 text-muted-foreground">{description}</p>
  </div>
)

export default function MarketingPanel({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        'relative flex flex-col justify-center overflow-hidden bg-[linear-gradient(138deg,#dbeafe_25%,#ffebd8_100%)] px-6 py-12 lg:px-12 lg:py-16 xl:px-20',
        className,
      )}
    >
      <div className="mx-auto flex w-full max-w-[608px] flex-col gap-10 lg:mx-0">
        <header className="flex flex-col gap-3">
          <h2 className="font-outfit text-[32px] leading-[40px] font-bold text-[#0a0a0a]">
            Your Path to Victory. 100% Free.
          </h2>
          <p className="text-sm leading-5 text-muted-foreground">
            Get your winning plan. Built for you. Ready in 2 mins.
          </p>
        </header>

        <div className="flex flex-col gap-8 lg:flex-row lg:items-start lg:gap-10">
          <div className="flex flex-col gap-4 lg:mt-[72px]">
            <StatCard />
            <FeatureBlock
              icon={ClipboardList}
              title="Campaign Plan"
              description="Get a free, step-by-step plan to win your race"
            />
          </div>

          <div className="flex flex-col gap-4">
            <VoterDemographicsCard />
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
