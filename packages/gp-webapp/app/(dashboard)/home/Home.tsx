'use client'

import NextThingCard from './NextThingCard'
import HomeComposer from './HomeComposer'

/**
 * Home is the one next thing, under a friendly headline about it, and a chat
 * box. The chat box lives in the page here; every other page keeps the fixed
 * footer bar (CampaignManagerChatProvider skips it on /home).
 */
export default function Home(): React.JSX.Element {
  return (
    <div className="flex min-h-screen flex-col">
      <div className="mx-auto flex w-full max-w-[640px] flex-col gap-5 px-4 pb-16 pt-10 lg:pt-16">
        <NextThingCard />
        <HomeComposer />
      </div>
    </div>
  )
}
