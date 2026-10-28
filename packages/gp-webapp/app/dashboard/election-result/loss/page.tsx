'use client'
import { useRouter } from 'next/navigation'
import { Button } from '@styleguide'
import { useUser } from '@shared/hooks/useUser'
import { useServePlace } from 'app/dashboard/contacts/citizens-panel/managedPanelCopy'
import { ActiveProSubscriptionAlert } from '../components/ActiveProSubscriptionAlert'
import { CommunityCard } from '../components/CommunityCard'
import { BACK_TO_DASHBOARD, LOST_COPY } from '../electionResultCopy'

export default function LossPage(): React.JSX.Element {
  const router = useRouter()
  const [user] = useUser()
  const place = useServePlace()

  return (
    <div className="flex flex-col">
      <main className="flex-1 pb-24 md:pb-0">
        <section className="max-w-screen-md mx-auto p-4 sm:p-8 lg:p-12 bg-white md:border md:border-slate-200 md:rounded-xl md:mt-12">
          <ActiveProSubscriptionAlert className="mb-7" />
          <div className="flex flex-col gap-7">
            <div className="flex flex-col gap-3 text-center">
              <h1 className="font-semibold text-2xl md:text-4xl">
                {LOST_COPY.title(user?.firstName)}
              </h1>
              <p className="text-lg text-muted-foreground">
                {LOST_COPY.description}
              </p>
            </div>
            <CommunityCard
              description={LOST_COPY.communityDescription(place)}
            />
            <Button
              type="button"
              variant="ghost"
              size="large"
              className="w-full"
              onClick={() => router.replace('/dashboard')}
            >
              {BACK_TO_DASHBOARD}
            </Button>
          </div>
        </section>
      </main>
    </div>
  )
}
