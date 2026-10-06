'use client'

import HomeGreeting from './HomeGreeting'
import NextThingCard from './NextThingCard'
import HomeComposer from './HomeComposer'

/**
 * Home is the one next thing, under a short friendly greeting, and a chat
 * box. The chat box lives in the page here; every other page keeps the fixed
 * footer bar (CampaignManagerChatProvider skips it on /home).
 */
export default function Home(): React.JSX.Element {
  // On desktop the card itself sits at the center of the screen: the rows
  // above and below it split the leftover height evenly, whatever the
  // greeting and the chat box measure. Each row still grows to its content,
  // so a short screen scrolls from the top rather than clipping. A phone keeps
  // the simple centered stack, since the card is most of the screen anyway.
  return (
    <div className="mx-auto flex min-h-screen w-full max-w-[640px] flex-col justify-center gap-5 px-4 py-10 lg:grid lg:grid-cols-1 lg:grid-rows-[1fr_auto_1fr]">
      <div className="flex flex-col justify-end">
        <HomeGreeting />
      </div>
      <NextThingCard />
      <div>
        <HomeComposer />
      </div>
    </div>
  )
}
