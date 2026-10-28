// No 'use client': ElectionResultPage, the only caller, is a client component.
import { useQuery } from '@tanstack/react-query'
import { Button } from '@styleguide'
import {
  FileTextIcon,
  TargetIcon,
  UsersRoundIcon,
} from '@styleguide/components/ui/icons'
import { useCampaign } from '@shared/hooks/useCampaign'
import { useOrganization } from '@shared/organization-picker'
import { ConfettiField } from 'app/dashboard/pro-upgrade/components/ConfettiField'
import { onboardingDistrictStatsQueryOptions } from 'app/onboarding/components/VoterDemographicsStep'
import { useServePlace } from 'app/dashboard/contacts/citizens-panel/managedPanelCopy'
import { BACK_TO_DASHBOARD, WON_COPY } from '../electionResultCopy'
import { CommunityCard } from './CommunityCard'

const POINT_ICONS = [FileTextIcon, UsersRoundIcon, TargetIcon]

const VIDEO_TEXT_ID = 'who-gets-the-mic-text'

const WhoGetsTheMic = ({
  src,
  poster,
  className,
}: {
  src: string
  poster: string
  className: string
}): React.JSX.Element => (
  <video
    controls
    playsInline
    preload="metadata"
    poster={poster}
    aria-label={WON_COPY.pro.video.label}
    aria-describedby={VIDEO_TEXT_ID}
    className={`w-full rounded-xl bg-muted object-cover ${className}`}
  >
    <source src={src} type="video/mp4" />
  </video>
)

interface CongratulationsStepProps {
  isPro: boolean
  submitting: boolean
  onStartServing: () => void
  onBackToDashboard: () => void
}

// A2 for a Pro winner (the step into Serve onboarding), N1 without Pro.
export const CongratulationsStep = ({
  isPro,
  submitting,
  onStartServing,
  onBackToDashboard,
}: CongratulationsStepProps): React.JSX.Element => {
  const [campaign] = useCampaign()
  const organization = useOrganization()
  const place = useServePlace()
  const statsOptions = onboardingDistrictStatsQueryOptions({
    orgPositionId: organization?.position?.brPositionId,
  })
  const { data: stats } = useQuery({
    ...statsOptions,
    enabled: isPro && statsOptions.enabled !== false,
  })
  const topIssue = campaign?.details?.customIssues?.[0]?.title?.trim() || null
  const points = WON_COPY.pro.points({
    place,
    population: stats?.districtPopulation ?? null,
    topIssue,
  })

  return (
    <div className="relative flex w-full flex-col gap-7">
      <div className="motion-reduce:hidden">
        <ConfettiField />
      </div>
      <div className="relative flex flex-col gap-3">
        <h1 className="text-2xl font-semibold md:text-4xl">{WON_COPY.title}</h1>
        <p className="text-lg text-muted-foreground">
          {isPro
            ? WON_COPY.pro.description(place)
            : WON_COPY.withoutPro.description}
        </p>
      </div>

      {isPro ? (
        <>
          <div className="relative grid grid-cols-1 items-start gap-7 md:grid-cols-2 md:gap-8">
            {/* One source per frame: the landscape cut from md up, the
                square one below. */}
            <div>
              <WhoGetsTheMic
                src="/videos/who-gets-the-mic-landscape.mp4"
                poster="/videos/who-gets-the-mic-landscape.jpg"
                className="hidden aspect-video md:block"
              />
              <WhoGetsTheMic
                src="/videos/who-gets-the-mic-square.mp4"
                poster="/videos/who-gets-the-mic-square.jpg"
                className="aspect-square md:hidden"
              />
              <p id={VIDEO_TEXT_ID} className="sr-only">
                {WON_COPY.pro.video.textAlternative}
              </p>
            </div>
            <ul className="flex flex-col gap-5">
              {points.map((point, index) => {
                const Icon = POINT_ICONS[index] ?? TargetIcon
                return (
                  <li key={point.title} className="flex items-start gap-3">
                    <Icon
                      className="size-6 shrink-0 text-primary"
                      aria-hidden
                    />
                    <span>
                      <span className="block font-semibold">{point.title}</span>
                      <span className="block text-muted-foreground">
                        {point.description}
                      </span>
                    </span>
                  </li>
                )
              })}
              <li className="hidden border-t border-base-border pt-4 text-sm text-muted-foreground md:list-item">
                {WON_COPY.pro.briefingNote}
              </li>
            </ul>
          </div>
          <div className="relative flex justify-end border-t border-base-border pt-6">
            <Button
              type="button"
              size="large"
              className="w-full md:w-auto"
              onClick={onStartServing}
              disabled={submitting}
              loading={submitting}
            >
              {WON_COPY.pro.start}
            </Button>
          </div>
        </>
      ) : (
        <>
          <div className="relative">
            <CommunityCard
              description={WON_COPY.withoutPro.communityDescription}
            />
          </div>
          <Button
            type="button"
            variant="ghost"
            size="large"
            className="relative w-full"
            onClick={onBackToDashboard}
          >
            {BACK_TO_DASHBOARD}
          </Button>
        </>
      )}
    </div>
  )
}
