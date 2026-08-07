'use client'

import { HandCoins } from 'lucide-react'
import { Card } from '@goodparty_org/styleguide'
import { ScreenLayout } from '../components/ScreenLayout'

// In the Lovable original this route is a 404 stub — surfaced here as an explicit
// "not built yet" empty state rather than a broken page.
export const Fundraising = () => (
  <ScreenLayout title="Fundraising" hideAiBar>
    <Card className="items-center gap-3 p-10 text-center">
      <span className="bg-primary-light text-primary flex size-12 items-center justify-center rounded-full">
        <HandCoins className="size-6" />
      </span>
      <div className="space-y-1">
        <p className="text-foreground font-semibold">
          Fundraising isn&apos;t built yet
        </p>
        <p className="text-muted-foreground text-sm">
          This section is a placeholder in the source prototype. We&apos;ll
          design it in a later pass.
        </p>
      </div>
    </Card>
  </ScreenLayout>
)
