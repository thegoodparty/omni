'use client'

import { useUser } from '@shared/hooks/useUser'
import NextThingCard from './NextThingCard'
import HomeComposer from './HomeComposer'

/**
 * Home is the one next thing and a chat box about it, and nothing else. The
 * chat box lives in the page here; every other page keeps the fixed footer bar
 * (CampaignManagerChatProvider skips it on /home).
 */
export default function Home(): React.JSX.Element {
  const [user] = useUser()
  const firstName = user?.firstName

  return (
    <div className="flex min-h-screen flex-col bg-muted">
      <div className="mx-auto flex w-full max-w-[640px] flex-col gap-5 px-4 pb-16 pt-10 lg:pt-16">
        <p className="text-balance text-2xl font-semibold text-foreground lg:text-3xl">
          {firstName
            ? `${firstName}, here's your next step`
            : "Here's your next step"}
        </p>
        <NextThingCard />
        <HomeComposer />
      </div>
    </div>
  )
}
