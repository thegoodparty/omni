'use client'

import Link from 'next/link'
import { useState } from 'react'
import { useUser } from '@shared/hooks/useUser'
import { ArchiveIcon } from '@styleguide/components/ui/icons'
import { chiefOfStaffArchiveHref } from '../routes'
import SupportHero from './SupportHero'
import OnboardingCards from './OnboardingCards'
import TaskList from './TaskList'
import FooterChatBar from './chat/FooterChatBar'
import ChiefOfStaffChatSurface from './chat/ChiefOfStaffChatSurface'

/**
 * Chief of Staff dashboard (Serve home). Renders inside `DashboardLayout`.
 * Owns the chat-surface open state so both the footer bar and the onboarding
 * CTAs can open it.
 */
export default function DashboardContent(): React.JSX.Element {
  const [user] = useUser()
  const [chatOpen, setChatOpen] = useState(false)

  const firstName = user?.firstName || undefined

  return (
    <div className="flex min-h-screen flex-col bg-muted pb-20 lg:pb-12">
      <div className="mx-auto flex w-full max-w-[608px] flex-col gap-6 p-4 pb-40 lg:p-6 lg:pb-40">
        <SupportHero />

        <section className="flex flex-col gap-4">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-base font-semibold text-foreground">
              Your prioritized tasks this week
            </h2>
            <Link
              href={chiefOfStaffArchiveHref()}
              className="inline-flex items-center gap-1.5 self-center text-sm font-medium text-muted-foreground underline-offset-4 hover:underline"
            >
              <ArchiveIcon className="size-4" aria-hidden />
              <span className="hidden sm:inline">Archive</span>
            </Link>
          </div>
          <OnboardingCards onOpenChat={() => setChatOpen(true)} />
          <TaskList />
        </section>
      </div>

      <FooterChatBar firstName={firstName} onOpen={() => setChatOpen(true)} />
      <ChiefOfStaffChatSurface open={chatOpen} onOpenChange={setChatOpen} />
    </div>
  )
}
