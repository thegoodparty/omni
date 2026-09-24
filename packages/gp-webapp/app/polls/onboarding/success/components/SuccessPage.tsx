'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { EVENTS, trackEvent } from 'helpers/analyticsHelper'
import { ConfettiBurst } from '@styleguide'
import { CheckIcon } from '@styleguide/components/ui/icons'

export default function SuccessPage({ pollId }: { pollId: string }) {
  const router = useRouter()
  const [celebrate, setCelebrate] = useState(false)

  useEffect(() => {
    trackEvent(EVENTS.ServeOnboarding.SuccessPageViewed)
  }, [])

  // A beat after mount rather than immediately, so the burst is not already
  // half over by the time the page finishes painting.
  useEffect(() => {
    const timeoutId = setTimeout(() => setCelebrate(true), 150)
    return () => clearTimeout(timeoutId)
  }, [])

  useEffect(() => {
    const timeoutId = setTimeout(() => {
      router.replace(`/dashboard/polls/${encodeURIComponent(pollId)}`)
    }, 4000)
    return () => clearTimeout(timeoutId)
  }, [router])

  return (
    <div className="flex flex-col">
      <main className="flex-1 pb-24 md:pb-0">
        <section className="max-w-screen-md mx-auto p-4 sm:p-8 lg:p-16 bg-white md:border md:border-slate-200 md:rounded-xl md:mt-12">
          <div className="flex flex-col items-center md:justify-center mb-12">
            {/* Sized to the burst, which overflows its 24px center box. */}
            <div className="flex h-20 w-20 mx-auto mb-6 items-center justify-center">
              <ConfettiBurst play={celebrate}>
                <CheckIcon className="h-5 w-5 text-primary" />
              </ConfettiBurst>
            </div>
            <h1 className="text-left md:text-center font-semibold text-2xl md:text-4xl w-full mb-2">
              Your first poll has been scheduled
            </h1>
            <p className="text-left md:text-center mt-4 text-lg font-normal text-muted-foreground mb-2">
              You&apos;ve taken your first step toward shaping the future of
              your community — <br /> and that&apos;s something to be proud of.
            </p>
            <p className="text-left md:text-center mt-4 font-normal text-blue">
              You will be taken to your poll momentarily...
            </p>
          </div>
        </section>
      </main>
    </div>
  )
}
