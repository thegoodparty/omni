'use client'

import NextThingCard from './NextThingCard'
import HomeComposer from './HomeComposer'

/**
 * Home is the one next thing, under a short friendly headline, and a chat
 * box. The chat box lives in the page here; every other page keeps the fixed
 * footer bar (CampaignManagerChatProvider skips it on /home).
 */
export default function Home(): React.JSX.Element {
  // Centered top to bottom: with this little on the page, top-aligning it
  // leaves most of the screen empty below. m-auto rather than justify-center,
  // so a stack taller than the screen still scrolls from its top.
  return (
    <div className="flex min-h-screen flex-col">
      <div className="m-auto flex w-full max-w-[640px] flex-col gap-5 px-4 py-10">
        <NextThingCard />
        <HomeComposer />
      </div>
    </div>
  )
}
