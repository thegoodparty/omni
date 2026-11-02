// No 'use client': ElectionResultPage, the only caller, is a client component.
import { useCallback, useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Button, Progress } from '@styleguide'
import {
  FlagIcon,
  MessagesSquareIcon,
  UsersRoundIcon,
} from '@styleguide/components/ui/icons'
import { clientRequest } from 'gpApi/typed-request'
import { useCampaign } from '@shared/hooks/useCampaign'
import { useOrganization } from '@shared/organization-picker'
import { usePositionName } from '@shared/hooks/usePositionName'
import { ConfettiField } from 'app/dashboard/pro-upgrade/components/ConfettiField'
import { onboardingDistrictStatsQueryOptions } from 'app/onboarding/components/VoterDemographicsStep'
import { useServePlace } from 'app/dashboard/contacts/citizens-panel/managedPanelCopy'
import { WON_COPY, issueInSentence } from '../electionResultCopy'

export const CELEBRATE_MS = 3_000
const CELEBRATE_TICK_MS = 100

const VIDEO_TEXT_ID = 'who-gets-the-mic-text'

const prefersReducedMotion = (): boolean =>
  typeof window !== 'undefined' &&
  window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true

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

// The celebration: the win, with confetti, for a few seconds. The bar shows
// the wait; reduced motion keeps it still but the step still moves on.
const Celebrate = ({ onDone }: { onDone: () => void }): React.JSX.Element => {
  const positionName = usePositionName()
  const [reduced] = useState(prefersReducedMotion)
  const [elapsed, setElapsed] = useState(0)

  useEffect(() => {
    const done = setTimeout(onDone, CELEBRATE_MS)
    const tick = reduced
      ? undefined
      : setInterval(
          () => setElapsed((ms) => ms + CELEBRATE_TICK_MS),
          CELEBRATE_TICK_MS,
        )
    return () => {
      clearTimeout(done)
      if (tick) clearInterval(tick)
    }
  }, [onDone, reduced])

  return (
    <div className="relative flex min-h-screen flex-col items-center justify-center gap-4 overflow-hidden bg-muted px-4 text-center">
      <div className="motion-reduce:hidden">
        <ConfettiField />
      </div>
      <h1 className="relative text-3xl font-semibold md:text-5xl">
        {WON_COPY.title}
      </h1>
      {positionName && (
        <p className="relative text-lg text-muted-foreground md:text-xl">
          {positionName}
        </p>
      )}
      <Progress
        aria-hidden
        value={reduced ? 0 : Math.min(100, (elapsed / CELEBRATE_MS) * 100)}
        className="relative mt-6 h-1 w-40"
      />
      <Button
        type="button"
        variant="ghost"
        className="relative"
        onClick={onDone}
      >
        {WON_COPY.pro.continue}
      </Button>
    </div>
  )
}

interface PrepareToServeProps {
  submitting: boolean
  onStartServing: () => void
}

// A2 for a Pro winner, in two steps: the celebration, then what comes next
// with the "Who gets the mic" video, three points on serving, and the one way
// on, into Serve onboarding.
export const PrepareToServe = ({
  submitting,
  onStartServing,
}: PrepareToServeProps): React.JSX.Element => {
  const [step, setStep] = useState<'celebrate' | 'next'>('celebrate')
  const headingRef = useRef<HTMLHeadingElement>(null)
  const [campaign] = useCampaign()
  const organization = useOrganization()
  const place = useServePlace()
  const statsOptions = onboardingDistrictStatsQueryOptions({
    orgPositionId: organization?.position?.brPositionId,
  })
  const { data: stats } = useQuery(statsOptions)
  const campaignId = campaign?.id
  // The issues editor's curated stances; their topic names read cleanly in a
  // sentence, which the candidate's own custom issue titles do not.
  const { data: positions } = useQuery({
    queryKey: ['campaign-positions', campaignId],
    queryFn: () =>
      clientRequest('GET /v1/campaigns/:id/positions', {
        id: String(campaignId),
      }).then((res) => res.data),
    enabled: campaignId !== undefined,
    staleTime: 5 * 60 * 1000,
  })
  const issue = positions ? issueInSentence(positions) : null

  useEffect(() => {
    if (step !== 'next') return
    window.scrollTo(0, 0)
    headingRef.current?.focus()
  }, [step])

  const showNext = useCallback(() => setStep('next'), [])

  if (step === 'celebrate') return <Celebrate onDone={showNext} />

  const { points } = WON_COPY.pro
  const pointList = [
    {
      key: 'represent',
      Icon: UsersRoundIcon,
      title: points.represent.title(place),
      description: points.represent.description(
        stats?.districtPopulation ?? null,
      ),
    },
    {
      key: 'hear',
      Icon: MessagesSquareIcon,
      title: points.hear.title,
      description: points.hear.description(place),
    },
    {
      key: 'ask',
      Icon: FlagIcon,
      title: points.ask.title,
      description: points.ask.description(issue),
    },
  ]

  return (
    <div className="flex flex-col">
      <main className="flex-1 pb-28 md:pb-12">
        <section className="mx-auto flex max-w-4xl flex-col gap-8 bg-card p-4 sm:p-8 md:mt-12 md:rounded-xl md:border md:border-base-border">
          <div className="flex flex-col gap-2">
            <h1
              ref={headingRef}
              tabIndex={-1}
              className="text-2xl font-semibold outline-none md:text-3xl"
            >
              {WON_COPY.pro.nextTitle(place)}
            </h1>
            <p className="text-lg text-muted-foreground">
              {WON_COPY.pro.nextLine(place)}
            </p>
          </div>
          <div className="grid gap-8 md:grid-cols-2 md:items-start">
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
            <div className="flex flex-col gap-6">
              <ul className="flex flex-col gap-5">
                {pointList.map(({ key, Icon, title, description }) => (
                  <li key={key} className="flex gap-3">
                    <Icon
                      className="mt-0.5 size-5 shrink-0 text-primary"
                      aria-hidden
                    />
                    <div className="flex flex-col gap-1">
                      <p className="font-semibold">{title}</p>
                      <p className="text-sm text-muted-foreground">
                        {description}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
              <p className="border-t border-base-border pt-4 text-xs text-muted-foreground">
                {WON_COPY.pro.footnote}
              </p>
            </div>
          </div>
          {/* Pinned to the bottom of a phone, the end of the card above it. */}
          <div className="fixed inset-x-0 bottom-0 border-t border-base-border bg-card p-4 md:static md:flex md:justify-end md:p-0 md:pt-6">
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
        </section>
      </main>
    </div>
  )
}
